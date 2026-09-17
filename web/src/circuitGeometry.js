import { componentCatalog } from './componentCatalog.js';

export const boardGrid = Object.freeze({ step: 34, offset: 17 });

export function clientPointInSvg(client, rect, viewBox) {
  return {
    x: viewBox.x + (client.x - rect.left) / rect.width * viewBox.width,
    y: viewBox.y + (client.y - rect.top) / rect.height * viewBox.height,
  };
}

export function snapBoardCoordinate(value, min, max) {
  const { step, offset } = boardGrid;
  const first = offset + Math.ceil((min - offset) / step) * step;
  const last = offset + Math.floor((max - offset) / step) * step;
  return Math.max(first, Math.min(last, offset + Math.round((value - offset) / step) * step));
}

export function snapComponentPosition(id, point) {
  const [minX, maxX, minY, maxY] = componentCatalog[id]?.bounds || [65, 830, 115, 590];
  return {
    x: snapBoardCoordinate(point.x, minX, maxX),
    y: snapBoardCoordinate(point.y, minY, maxY),
  };
}

export function pinPosition(game, pin) {
  const id = pin.split('.')[0];
  const offset = componentCatalog[id]?.terminals[pin];
  const position = game.positions[id];
  return offset && position ? { x: position.x + offset.x, y: position.y + offset.y } : null;
}

export function terminalAtPoint(game, point, exclude = null, radius = 23) {
  let closest = null;
  let distance = radius;
  for (const [id, placed] of Object.entries(game.placed)) {
    if (!placed) continue;
    for (const pin of Object.keys(componentCatalog[id]?.terminals || {})) {
      if (pin === exclude) continue;
      const position = pinPosition(game, pin);
      const candidate = Math.hypot(point.x - position.x, point.y - position.y);
      if (candidate < distance) { closest = pin; distance = candidate; }
    }
  }
  return closest;
}

export const geometryWireKey = (a, b) => [a, b].sort().join('-');

function terminalSide(pin) {
  const offset = componentCatalog[pin.split('.')[0]]?.terminals[pin];
  if (!offset || Math.abs(offset.x) <= Math.abs(offset.y)) return null;
  return offset.x > 0 ? 'right' : 'left';
}

function verticalBounds(pin, point) {
  const component = componentCatalog[pin.split('.')[0]];
  const offset = component?.terminals[pin];
  const bounds = component?.visualBounds;
  if (!offset || !bounds) return { top: point.y - 20, bottom: point.y + 20 };
  const originY = point.y - offset.y;
  return { top: originY + bounds[2], bottom: originY + bounds[3] };
}

function rightExitDetour(a, b, key, from) {
  const [first, second] = key.split('-');
  const to = from === first ? second : first;
  const ends = [{ pin: from, point: a }, { pin: to, point: b }];
  const source = ends
    .filter(end => terminalSide(end.pin) === 'right')
    .sort((left, right) => right.point.x - left.point.x || left.pin.localeCompare(right.pin))
    .find(end => end.point.x >= ends.find(other => other !== end).point.x);
  if (!source) return null;
  const target = ends.find(end => end !== source);
  const sourceBounds = verticalBounds(source.pin, source.point);
  const targetBounds = verticalBounds(target.pin, target.point);
  const candidates = [];
  if (sourceBounds.bottom + 20 < targetBounds.top) candidates.push(Math.round((sourceBounds.bottom + targetBounds.top) / 2));
  if (targetBounds.bottom + 20 < sourceBounds.top) candidates.push(Math.round((targetBounds.bottom + sourceBounds.top) / 2));
  candidates.push(Math.min(sourceBounds.top, targetBounds.top) - 22, Math.max(sourceBounds.bottom, targetBounds.bottom) + 22);
  const targetKind = target.pin.split('.')[0];
  const valid = candidates.filter(y => y >= 20 && y <= 680 && (targetKind !== 'ground' || y < target.point.y) && (targetKind !== 'power' || y > target.point.y));
  const corridor = (valid.length ? valid : candidates).sort((y1, y2) =>
    Math.abs(source.point.y - y1) + Math.abs(target.point.y - y1) -
    Math.abs(source.point.y - y2) - Math.abs(target.point.y - y2))[0];
  const exitX = source.point.x + 30;
  const targetSide = terminalSide(target.pin);
  const approachX = target.point.x + (targetSide === 'left' ? -30 : targetSide === 'right' ? 30 : 0);
  const route = [source.point, { x: exitX, y: source.point.y }, { x: exitX, y: corridor },
    { x: approachX, y: corridor }];
  if (targetSide) route.push({ x: approachX, y: target.point.y });
  route.push(target.point);
  return from === source.pin ? route : route.reverse();
}

export function wireRoute(a, b, key, from) {
  const detour = rightExitDetour(a, b, key, from);
  if (detour) return detour;
  if (key === geometryWireKey('power', 'mcu.vdd')) {
    const fromPower = from === 'power';
    const power = fromPower ? a : b;
    const vdd = fromPower ? b : a;
    const route = [power, { x: power.x, y: vdd.y }, vdd];
    return fromPower ? route : route.reverse();
  }
  if (key === geometryWireKey('mcu.gnd', 'ground')) {
    const fromMcu = from === 'mcu.gnd';
    const mcu = fromMcu ? a : b;
    const ground = fromMcu ? b : a;
    const route = [mcu, { x: mcu.x + 56, y: mcu.y }, { x: mcu.x + 56, y: ground.y }, ground];
    return fromMcu ? route : route.reverse();
  }
  if (key === geometryWireKey('led.b', 'ground')) {
    const fromLed = from === 'led.b';
    const led = fromLed ? a : b;
    const ground = fromLed ? b : a;
    const route = [led, { x: ground.x, y: led.y }, ground];
    return fromLed ? route : route.reverse();
  }
  if (Math.abs(a.y - b.y) < 4) return [a, { x: b.x, y: a.y }];
  const mid = Math.round((a.x + b.x) / 2);
  return [a, { x: mid, y: a.y }, { x: mid, y: b.y }, b];
}

export const routePath = route => route.map((point, index) => (index ? 'L' : 'M') + point.x + ' ' + point.y).join('');

function nearestOnSegment(point, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const portion = lengthSquared ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared)) : 0;
  const x = a.x + portion * dx;
  const y = a.y + portion * dy;
  return { x, y, distance: Math.hypot(point.x - x, point.y - y) };
}

export function snapProbe(game, point) {
  const bounded = { x: Math.max(35, Math.min(865, point.x)), y: Math.max(65, Math.min(620, point.y)), target: null, wire: null };
  let best = { distance: Infinity };
  const pins = Object.entries(game.placed).flatMap(([id, placed]) => placed ? Object.keys(componentCatalog[id]?.terminals || {}) : []);
  for (const target of pins) {
    const pin = pinPosition(game, target);
    const distance = Math.hypot(point.x - pin.x, point.y - pin.y);
    if (distance < 37 && distance < best.distance) best = { ...pin, target, wire: null, distance };
  }
  for (const wire of game.wires) {
    const [from, to] = wire.split('-');
    const a = pinPosition(game, from);
    const b = pinPosition(game, to);
    if (!a || !b) continue;
    const route = wireRoute(a, b, geometryWireKey(from, to), from);
    for (let index = 1; index < route.length; index++) {
      const candidate = nearestOnSegment(point, route[index - 1], route[index]);
      if (candidate.distance < 23 && candidate.distance < best.distance) best = { ...candidate, target: from, wire: geometryWireKey(from, to) };
    }
  }
  if (!Number.isFinite(best.distance)) return bounded;
  return { x: Math.round(best.x), y: Math.round(best.y), target: best.target, wire: best.wire };
}
