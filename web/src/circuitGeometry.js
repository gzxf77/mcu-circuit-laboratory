import { componentSpec } from './componentCatalog.js';

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
  const [minX, maxX, minY, maxY] = componentSpec(id)?.bounds || [65, 830, 115, 590];
  return {
    x: snapBoardCoordinate(point.x, minX, maxX),
    y: snapBoardCoordinate(point.y, minY, maxY),
  };
}

export function pinPosition(game, pin) {
  const id = pin.split('.')[0];
  const offset = componentSpec(id)?.terminals[pin];
  const position = game.positions[id];
  return offset && position ? { x: position.x + offset.x, y: position.y + offset.y } : null;
}

export function terminalAtPoint(game, point, exclude = null, radius = 23) {
  let closest = null;
  let distance = radius;
  for (const [id, placed] of Object.entries(game.placed)) {
    if (!placed) continue;
    for (const pin of Object.keys(componentSpec(id)?.terminals || {})) {
      if (pin === exclude) continue;
      const position = pinPosition(game, pin);
      if (!position) continue;
      const candidate = Math.hypot(point.x - position.x, point.y - position.y);
      if (candidate < distance) { closest = pin; distance = candidate; }
    }
  }
  return closest;
}

export const geometryWireKey = (a, b) => [a, b].sort().join('-');

function terminalSide(pin) {
  const offset = componentSpec(pin.split('.')[0])?.terminals[pin];
  if (!offset || Math.abs(offset.x) <= Math.abs(offset.y)) return null;
  return offset.x > 0 ? 'right' : 'left';
}

const partOf = pin => pin.split('.')[0];
const uniqueNumbers = values => [...new Set(values.filter(Number.isFinite).map(value => Math.round(value)))];

// ---------------------------------------------------------------------------
// Wire routing
//
// Wires are orthogonal polylines that keep clear of component bodies. The route
// depends only on the two endpoints, the endpoints' terminal sides and the
// placed components — never on which endpoint the player grabbed first — so the
// drawn wire, the drag preview, the current animation and probe snapping all
// agree, and the reverse route is the same polyline read backwards.

// Extra clearance kept around every component body.
export const routeClearance = 14;
// A wire must leave / reach a side terminal perpendicular to that side. The stub
// only has to establish that direction: keeping it short lets the wire turn as
// soon as the space allows instead of jogging around its own symbol.
const routeStub = 8;
const bendPenalty = 20;
// Two severities: running through a symbol's own box must never pay off, while
// merely entering its clearance ring is a mild nudge. Sandbox boards with many
// parts overlap rings constantly; without this split the router would clip a
// symbol rather than graze a ring.
const inkPenalty = 1000000;
// A tie-breaker, not a constraint: keeping the 14px ring costs half a point per
// pixel, so it decides between equally direct routes and never buys a detour.
// The symbol box itself stays absolute at inkPenalty.
const clearancePenalty = 0.5;
// A crossing is not a tie-breaker, it is a visual error: two strokes that cross
// read as a junction. It therefore costs more than any detour the 900x700 board
// can express (the longest sensible single-layer loop is a few thousand px at one point each),
// so a wire walks around the board instead of over another wire whenever any
// clear route exists at all. It still stays far below one pixel of inkPenalty,
// so the absolute rule "never enter a symbol" outranks it.
const crossingPenalty = 20000;
// Overlap is the worst of the two line-quality faults — two wires on the same
// track read as one net — so it is priced per pixel, above a modest detour.
const overlappingPenalty = 60;
const boardArea = Object.freeze({ minX: 2, maxX: 898, minY: 2, maxY: 698 });

function bodyRect(id, position) {
  const bounds = componentSpec(id)?.visualBounds;
  if (!bounds || !position) return null;
  return {
    id,
    minX: position.x + bounds[0], maxX: position.x + bounds[1],
    minY: position.y + bounds[2], maxY: position.y + bounds[3],
  };
}

// The pin sits on the body's edge, so recover the body box from the pin point.
// Rotated terminals (e.g. MCU pins) put their body beside the pin, not around
// it, so the box is kept on the body's side of the pin only.
function bodyRectAlongPin(pin, point) {
  const id = partOf(pin);
  const bounds = componentSpec(id)?.visualBounds;
  const offset = componentSpec(id)?.terminals[pin];
  if (!bounds || !offset || !point) return null;
  const originX = point.x - offset.x;
  const originY = point.y - offset.y;
  const rect = { id, minX: originX + bounds[0], maxX: originX + bounds[1], minY: originY + bounds[2], maxY: originY + bounds[3] };
  const side = terminalSide(pin);
  if (side === 'right') return { ...rect, maxX: point.x };
  if (side === 'left') return { ...rect, minX: point.x };
  return rect;
}

export function componentObstacles(game) {
  return Object.entries(game.placed || {})
    .filter(([, placed]) => placed)
    .map(([id]) => bodyRect(id, game.positions?.[id]))
    .filter(Boolean);
}

// Carries the symbol's own box plus the padded box that candidate corridors and
// scoring use. `ink` is never optional: it is the box a stroke must not enter.
const withClearance = (rect, pad = routeClearance) => ({
  id: rect.id,
  ink: rect,
  minX: rect.minX - pad, maxX: rect.maxX + pad,
  minY: rect.minY - pad, maxY: rect.maxY + pad,
});

// Length of an axis-aligned segment that runs inside a rectangle. `allowance`
// forgives the stub that necessarily overlaps the endpoint's own body.
function overlapLength(from, to, rect, allowance = 0) {
  if (!rect) return 0;
  let raw = 0;
  if (from.x === to.x) {
    if (from.x > rect.minX && from.x < rect.maxX) {
      raw = Math.min(Math.max(from.y, to.y), rect.maxY) - Math.max(Math.min(from.y, to.y), rect.minY);
    }
  } else if (from.y === to.y) {
    if (from.y > rect.minY && from.y < rect.maxY) {
      raw = Math.min(Math.max(from.x, to.x), rect.maxX) - Math.max(Math.min(from.x, to.x), rect.minX);
    }
  }
  return Math.max(0, raw - allowance);
}

// Axis-aligned segments only: returns where they cross, or null. Touching at an
// endpoint does not count, so wires that legitimately meet at a terminal are
// free while a true interior crossing is not.
function crossPoint(a, b, c, d) {
  const aVertical = a.x === b.x;
  const cVertical = c.x === d.x;
  if (aVertical === cVertical) return null;
  const [verticalStart, verticalEnd] = aVertical ? [a, b] : [c, d];
  const [horizontalStart, horizontalEnd] = aVertical ? [c, d] : [a, b];
  const x = verticalStart.x;
  const y = horizontalStart.y;
  const insideVertical = y > Math.min(verticalStart.y, verticalEnd.y) && y < Math.max(verticalStart.y, verticalEnd.y);
  const insideHorizontal = x > Math.min(horizontalStart.x, horizontalEnd.x) && x < Math.max(horizontalStart.x, horizontalEnd.x);
  return insideVertical && insideHorizontal ? { x, y } : null;
}

// Length shared by two collinear segments (wires drawn on top of each other).
function stackedLength(a, b, c, d) {
  if (a.x === b.x && c.x === d.x && a.x === c.x) {
    const shared = Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)) - Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y));
    return Math.max(0, shared);
  }
  if (a.y === b.y && c.y === d.y && a.y === c.y) {
    const shared = Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) - Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x));
    return Math.max(0, shared);
  }
  return 0;
}

// What a polyline costs against the wires already on the board.
// Wires whose points never enter the candidate's bounding box cannot cross it,
// so they are dropped before any segment is compared.
function nearWires(points, otherWires) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }
  return otherWires.filter(wire => wire.some(point =>
    point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY));
}

function wirePenalty(points, otherWires) {
  if (!otherWires.length) return 0;
  const nearby = otherWires.length > 1 ? nearWires(points, otherWires) : otherWires;
  if (!nearby.length) return 0;
  let penalty = 0;
  for (let index = 1; index < points.length; index++) {
    const from = points[index - 1];
    const to = points[index];
    const minX = Math.min(from.x, to.x);
    const maxX = Math.max(from.x, to.x);
    const minY = Math.min(from.y, to.y);
    const maxY = Math.max(from.y, to.y);
    for (const wire of nearby) {
      for (let step = 1; step < wire.length; step++) {
        const a = wire[step - 1];
        const b = wire[step];
        // Bounding boxes must overlap before an exact crossing test is worth it:
        // on a crowded board almost every pair is far apart.
        if (Math.min(a.x, b.x) > maxX || Math.max(a.x, b.x) < minX) continue;
        if (Math.min(a.y, b.y) > maxY || Math.max(a.y, b.y) < minY) continue;
        if (crossPoint(from, to, a, b)) penalty += crossingPenalty;
        else penalty += stackedLength(from, to, a, b) * overlappingPenalty;
      }
    }
  }
  return penalty;
}

// Which wires cross which: used both to measure the board and to pick only the
// wires that need another routing attempt.
function crossingConflicts(entries) {
  const conflicts = new Map();
  for (let first = 0; first < entries.length; first++) {
    for (let second = first + 1; second < entries.length; second++) {
      if (!crossesWires(entries[first][1], [entries[second][1]])) continue;
      if (!conflicts.has(entries[first][0])) conflicts.set(entries[first][0], new Set());
      if (!conflicts.has(entries[second][0])) conflicts.set(entries[second][0], new Set());
      conflicts.get(entries[first][0]).add(entries[second][0]);
      conflicts.get(entries[second][0]).add(entries[first][0]);
    }
  }
  return conflicts;
}

function countConflicts(conflicts) {
  let pairs = 0;
  const seen = new Set();
  for (const [key, others] of conflicts) {
    for (const other of others) {
      const pair = [key, other].sort().join('|');
      if (!seen.has(pair)) { seen.add(pair); pairs += 1; }
    }
  }
  return pairs;
}

function crossesWires(points, otherWires) {
  for (let index = 1; index < points.length; index++) {
    const from = points[index - 1];
    const to = points[index];
    for (const wire of otherWires) {
      for (let step = 1; step < wire.length; step++) {
        if (crossPoint(from, to, wire[step - 1], wire[step])) return true;
      }
    }
  }
  return false;
}

function simplifyPath(points) {
  const deduped = points.filter((point, index) => index === 0 || point.x !== points[index - 1].x || point.y !== points[index - 1].y);
  if (deduped.length <= 2) return deduped;
  const result = [deduped[0]];
  for (let index = 1; index < deduped.length - 1; index++) {
    const previous = result.at(-1);
    const current = deduped[index];
    const next = deduped[index + 1];
    const collinear = (previous.x === current.x && current.x === next.x) || (previous.y === current.y && current.y === next.y);
    if (!collinear) result.push(current);
  }
  result.push(deduped.at(-1));
  return result;
}

function respectsTerminalSides(points, startPin, endPin) {
  if (points.length < 2) return true;
  const startSide = terminalSide(startPin);
  if (startSide) {
    const sign = Math.sign(points[1].x - points[0].x);
    if (startSide === 'right' ? sign <= 0 : sign >= 0) return false;
  }
  const endSide = terminalSide(endPin);
  if (endSide) {
    const sign = Math.sign(points.at(-1).x - points.at(-2).x);
    if (endSide === 'right' ? sign >= 0 : sign <= 0) return false;
  }
  return true;
}

// The first segment may always leave its own component and the last segment may
// always reach it: a wire starts on its terminal, so crossing the component's own
// box there is unavoidable rather than a mistake. Every other segment — and every
// other component — stays fully priced, which is what still forbids folding a
// wire back across a body.
function isEndpointBody(rect, startPart, endPart, firstSegment, lastSegment) {
  return (firstSegment && rect.id === startPart) || (lastSegment && rect.id === endPart);
}

function routeScore(points, obstacles, startPart, endPart, budget = Infinity, otherWires = []) {
  let cost = wirePenalty(points, otherWires);
  for (let index = 1; index < points.length; index++) {
    const from = points[index - 1];
    const to = points[index];
    cost += Math.abs(to.x - from.x) + Math.abs(to.y - from.y);
    const firstSegment = index === 1;
    const lastSegment = index === points.length - 1;
    for (const rect of obstacles) {
      if (isEndpointBody(rect, startPart, endPart, firstSegment, lastSegment)) continue;
      cost += overlapLength(from, to, rect.ink) * inkPenalty;
      cost += overlapLength(from, to, rect) * clearancePenalty;
    }
    // Cost only grows along the polyline, so a candidate that already exceeds
    // the best known score can be abandoned before its remaining segments run.
    if (cost > budget) return Infinity;
  }
  return cost + Math.max(0, points.length - 2) * bendPenalty;
}

function runsThroughInk(points, obstacles, startPart, endPart) {
  for (let index = 1; index < points.length; index++) {
    const from = points[index - 1];
    const to = points[index];
    const firstSegment = index === 1;
    const lastSegment = index === points.length - 1;
    for (const rect of obstacles) {
      if (isEndpointBody(rect, startPart, endPart, firstSegment, lastSegment)) continue;
      if (overlapLength(from, to, rect.ink) > 0) return true;
    }
  }
  return false;
}

function routeCandidates(startPin, startPoint, endPin, endPoint, obstacles) {
  const startSide = terminalSide(startPin);
  const endSide = terminalSide(endPin);
  const startDir = startSide === 'right' ? 1 : startSide === 'left' ? -1 : 0;
  const endDir = endSide === 'right' ? 1 : endSide === 'left' ? -1 : 0;
  const clampX = value => Math.max(boardArea.minX, Math.min(boardArea.maxX, value));
  const startStub = { x: clampX(startPoint.x + startDir * routeStub), y: startPoint.y };
  const endStub = { x: clampX(endPoint.x + endDir * routeStub), y: endPoint.y };
  const startRect = bodyRectAlongPin(startPin, startPoint);
  const endRect = bodyRectAlongPin(endPin, endPoint);
  const startPart = partOf(startPin);
  const endPart = partOf(endPin);
  const other = obstacles.filter(rect => rect.id !== startPart && rect.id !== endPart);

  const xOptions = uniqueNumbers([
    (startPoint.x + endPoint.x) / 2,
    (startStub.x + endStub.x) / 2,
    startStub.x, endStub.x,
    startStub.x + startDir * routeStub,
    endStub.x + endDir * routeStub,
    boardArea.minX, boardArea.maxX,
    ...other.flatMap(rect => [rect.minX, rect.maxX, rect.ink.minX, rect.ink.maxX]),
    ...(startRect ? [startRect.minX, startRect.maxX] : []),
    ...(endRect ? [endRect.minX, endRect.maxX] : []),
  ]).filter(x => x >= boardArea.minX && x <= boardArea.maxX);

  const gapY = (() => {
    if (!startRect || !endRect) return null;
    const low = Math.min(startRect.maxY, endRect.maxY);
    const high = Math.max(startRect.minY, endRect.minY);
    return high - low > 4 ? (low + high) / 2 : null;
  })();
  const yOptions = uniqueNumbers([
    (startPoint.y + endPoint.y) / 2,
    startStub.y, endStub.y,
    boardArea.minY, boardArea.maxY,
    gapY,
    ...other.flatMap(rect => [rect.minY, rect.maxY, rect.ink.minY, rect.ink.maxY]),
    ...(startRect ? [startRect.minY, startRect.maxY] : []),
    ...(endRect ? [endRect.minY, endRect.maxY] : []),
  ]).filter(y => y >= boardArea.minY && y <= boardArea.maxY);

  const middles = startStub.y === endStub.y || startStub.x === endStub.x ? [[startStub, endStub]] : [];
  for (const x of xOptions) middles.push([startStub, { x, y: startStub.y }, { x, y: endStub.y }, endStub]);
  for (const y of yOptions) middles.push([startStub, { x: startStub.x, y }, { x: endStub.x, y }, endStub]);
  return middles
    .map(middle => simplifyPath([startPoint, ...middle, endPoint]))
    .filter(points => points.length >= 2);
}

// Grid search used when every simple candidate still runs through a body: the
// coordinate lines are the board edges, the component-box edges and the stub
// rows/columns, which is enough to walk around any placed component. Costs use
// the same overlap and bend weights as the candidate scoring, so both paths
// agree on what "clear and short" means.
function searchRoute(startPin, startPoint, endPin, endPoint, obstacles, otherWires = []) {
  // The search starts and ends at the pins themselves; the only structural rule
  // is that a side terminal is left / reached from its own side, so the stub
  // length adapts to whatever space the neighbouring parts leave free.
  const startSideDir = terminalSide(startPin) === 'right' ? 0 : terminalSide(startPin) === 'left' ? 1 : null;
  const endSideDir = terminalSide(endPin) === 'right' ? 1 : terminalSide(endPin) === 'left' ? 0 : null;
  const startPart = partOf(startPin);
  const endPart = partOf(endPin);
  const inBoard = value => value >= boardArea.minX && value <= boardArea.maxX;
  const inBoardY = value => value >= boardArea.minY && value <= boardArea.maxY;
  const xs = uniqueNumbers([
    boardArea.minX, boardArea.maxX,
    startPoint.x + routeStub, startPoint.x - routeStub, endPoint.x + routeStub, endPoint.x - routeStub,
    (startPoint.x + endPoint.x) / 2,
    ...obstacles.flatMap(rect => [rect.minX, rect.maxX, rect.ink.minX, rect.ink.maxX]),
  ]).filter(inBoard);
  const ys = uniqueNumbers([
    boardArea.minY, boardArea.maxY,
    (startPoint.y + endPoint.y) / 2,
    ...obstacles.flatMap(rect => [rect.minY, rect.maxY, rect.ink.minY, rect.ink.maxY]),
  ]).filter(inBoardY);
  // Endpoints are never filtered away: a pin may sit outside the corridor area.
  xs.push(startPoint.x, endPoint.x);
  ys.push(startPoint.y, endPoint.y);
  xs.sort((a, b) => a - b);
  ys.sort((a, b) => a - b);
  if (xs.length < 2 || ys.length < 2) return null;

  // Incoming direction: 0 +x, 1 -x, 2 +y, 3 -y, 4 none (start).
  const directions = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const startX = xs.indexOf(startPoint.x);
  const startY = ys.indexOf(startPoint.y);
  const endX = xs.indexOf(endPoint.x);
  const endY = ys.indexOf(endPoint.y);
  if (startX < 0 || startY < 0 || endX < 0 || endY < 0) return null;
  const columns = ys.length;
  const stateOf = (xIndex, yIndex, direction) => (xIndex * columns + yIndex) * 5 + direction;
  const best = new Float64Array(xs.length * columns * 5).fill(Infinity);
  const previous = new Int32Array(xs.length * columns * 5).fill(-1);
  const startState = stateOf(startX, startY, 4);
  best[startState] = 0;
  // Simple binary heap over [cost, state].
  const heap = [[0, startState]];
  const push = entry => {
    heap.push(entry);
    let index = heap.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (heap[parent][0] <= heap[index][0]) break;
      [heap[parent], heap[index]] = [heap[index], heap[parent]];
      index = parent;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let index = 0;
      for (;;) {
        const left = index * 2 + 1;
        const right = left + 1;
        let smallest = index;
        if (left < heap.length && heap[left][0] < heap[smallest][0]) smallest = left;
        if (right < heap.length && heap[right][0] < heap[smallest][0]) smallest = right;
        if (smallest === index) break;
        [heap[smallest], heap[index]] = [heap[index], heap[smallest]];
        index = smallest;
      }
    }
    return top;
  };
  const allowanceFor = (rect, fromStart, toEnd) => isEndpointBody(rect, startPart, endPart, fromStart, toEnd);

  while (heap.length) {
    const [cost, state] = pop();
    if (cost > best[state]) continue;
    const direction = state % 5;
    const cell = (state - direction) / 5;
    const xIndex = Math.floor(cell / columns);
    const yIndex = cell % columns;
    if (xIndex === endX && yIndex === endY) {
      const points = [];
      for (let walk = state; walk !== -1; walk = previous[walk]) {
        const item = walk % 5;
        const index = (walk - item) / 5;
        points.push({ x: xs[Math.floor(index / columns)], y: ys[index % columns] });
      }
      // points already run from the start pin to the end pin.
      return simplifyPath(points.toReversed());
    }
    const atStart = xIndex === startX && yIndex === startY;
    directions.forEach(([dx, dy], next) => {
      const nextX = xIndex + dx;
      const nextY = yIndex + dy;
      if (nextX < 0 || nextX >= xs.length || nextY < 0 || nextY >= columns) return;
      // Terminal sides are structural: the first move leaves the pin on its own
      // side and the final move reaches the pin from that same side.
      if (atStart && startSideDir !== null && next !== startSideDir) return;
      if (nextX === endX && nextY === endY && endSideDir !== null && next !== endSideDir) return;
      const from = { x: xs[xIndex], y: ys[yIndex] };
      const to = { x: xs[nextX], y: ys[nextY] };
      const fromStart = atStart;
      const toEnd = nextX === endX && nextY === endY;
      let step = Math.abs(to.x - from.x) + Math.abs(to.y - from.y);
      for (const rect of obstacles) {
        if (allowanceFor(rect, fromStart, toEnd)) continue;
        step += overlapLength(from, to, rect.ink) * inkPenalty;
        step += overlapLength(from, to, rect) * clearancePenalty;
      }
      step += wirePenalty([from, to], otherWires);
      if (direction !== 4 && direction !== next) step += bendPenalty;
      const nextState = stateOf(nextX, nextY, next);
      const nextCost = cost + step;
      if (nextCost < best[nextState]) {
        best[nextState] = nextCost;
        previous[nextState] = state;
        push([nextCost, nextState]);
      }
    });
  }
  return null;
}

function pickRoute(startPin, startPoint, endPin, endPoint, obstacles, otherWires = []) {
  const candidates = routeCandidates(startPin, startPoint, endPin, endPoint, obstacles);
  const startPart = partOf(startPin);
  const endPart = partOf(endPin);
  let best = null;
  let bestScore = Infinity;
  let bestClear = false;
  for (const points of candidates) {
    if (!respectsTerminalSides(points, startPin, endPin)) continue;
    const score = routeScore(points, obstacles, startPart, endPart, bestScore, otherWires);
    if (score === Infinity) continue;
    if (score < bestScore) {
      best = points;
      bestScore = score;
      bestClear = !runsThroughInk(points, obstacles, startPart, endPart) && !crossesWires(points, otherWires);
    }
  }
  // Simple candidates win whenever one of them avoids every symbol and every
  // other wire; the grid search only runs when none of them does.
  if (best && bestClear) return best;
  const searched = searchRoute(startPin, startPoint, endPin, endPoint, obstacles, otherWires);
  if (searched) {
    const searchedScore = routeScore(searched, obstacles, startPart, endPart, bestScore, otherWires);
    if (!best || searchedScore < bestScore) return searched;
  }
  if (best) return best;
  // No candidate satisfied the side rules (dense board): fall back to the
  // lowest-collision route so the wire still stays as clear as possible.
  for (const points of candidates) {
    const score = routeScore(points, obstacles, startPart, endPart, bestScore);
    if (score < bestScore) { best = points; bestScore = score; }
  }
  return best || simplifyPath([startPoint, { x: startPoint.x, y: endPoint.y }, endPoint]);
}

export function wireRoute(a, b, key, from, obstacles = [], otherWires = []) {
  const [firstPin, secondPin] = key.split('-');
  // Canonical orientation is always firstPin -> secondPin, so both drag
  // directions and the committed wire resolve to the same polyline.
  const aBelongsToFirst = from === firstPin;
  const startPin = firstPin;
  const endPin = secondPin;
  const startPoint = aBelongsToFirst ? a : b;
  const endPoint = aBelongsToFirst ? b : a;
  const startPart = partOf(startPin);
  const endPart = partOf(endPin);
  const endpointRects = [bodyRectAlongPin(startPin, startPoint), bodyRectAlongPin(endPin, endPoint)]
    .filter(Boolean)
    .map(rect => withClearance(rect));
  // The two endpoint bodies are always known from terminal geometry, even when
  // no obstacle list is supplied; the caller's copy of them is replaced so each
  // endpoint body is described exactly once.
  const others = obstacles
    .filter(rect => rect.id !== startPart && rect.id !== endPart)
    .map(rect => withClearance(rect));
  const route = pickRoute(startPin, startPoint, endPin, endPoint, [...others, ...endpointRects], otherWires);
  return aBelongsToFirst ? route : route.toReversed();
}

// Routing is the expensive part of a pointer move (every wire is re-snapped and
// re-rendered), while a wire's route depends on the placed components' positions
// and on which other wires are already on the board. Cache by that fingerprint
// so a sandbox board with dozens of parts and wires keeps up, and invalidate
// automatically whenever a part is placed, removed or moved or a wire changes.
const routeCache = new Map();
const routeCacheLimit = 800;

export function clearRouteCache() {
  routeCache.clear();
}

function geometrySignature(game) {
  let signature = '';
  for (const [id, placed] of Object.entries(game.placed || {})) {
    if (!placed) continue;
    const position = game.positions?.[id];
    if (!position) continue;
    signature += id + ':' + position.x + ',' + position.y + ';';
  }
  return signature;
}

// One resolver per render / per pointer move: signature, obstacle list and the
// routes of the wires already on the board are prepared once, then every wire is
// looked up or routed on demand.
//
// Crossings are resolved in two passes so the result never depends on the order
// wires were created: first every existing wire is routed clear of components
// only, then each one is routed again avoiding the others' first-pass polylines.
// A wire added later therefore leaves the existing routes untouched.
export function createRouteResolver(game) {
  const obstacles = componentObstacles(game);
  const wireKeys = [...new Set(game.wires || [])].sort();
  const signature = geometrySignature(game) + '|' + wireKeys.join(',');
  // `variant` keeps each iteration in its own cache namespace so a wire is never
  // handed a route that was computed against a different set of neighbours.
  const routeOf = (from, to, otherWires, variant = '') => {
    const a = pinPosition(game, from);
    const b = pinPosition(game, to);
    if (!a || !b) return null;
    const cacheKey = signature + '#' + variant + from + '>' + to;
    const cached = routeCache.get(cacheKey);
    if (cached) return cached;
    const route = wireRoute(a, b, geometryWireKey(from, to), from, obstacles, otherWires);
    if (routeCache.size >= routeCacheLimit) routeCache.clear();
    routeCache.set(cacheKey, route);
    return route;
  };
  // Keys are the normalised (sorted) wire keys, so a lookup by either drag
  // direction finds the wire's stored route.
  let settled = new Map();
  for (const wire of wireKeys) {
    const [from, to] = wire.split('-');
    settled.set(geometryWireKey(from, to), { route: routeOf(from, to, [], 'p1:'), from });
  }
  // Relax the whole board until no two wires cross any more (or the cap is hit),
  // keeping the calmest round seen. Every wire always sees the others' current
  // routes, so the result does not depend on the order wires were created.
  let best = settled;
  let bestConflicts = countConflicts(crossingConflicts([...settled.entries()].map(([key, entry]) => [key, entry.route])));
  for (let round = 0; round < 4 && bestConflicts > 0; round++) {
    // Only the wires that actually cross are re-routed; the calm ones keep the
    // route they already have, which keeps crowded boards affordable.
    const conflicts = crossingConflicts([...settled.entries()].map(([key, entry]) => [key, entry.route]));
    if (!conflicts.size) break;
    const next = new Map(settled);
    for (const key of conflicts.keys()) {
      const entry = settled.get(key);
      if (!entry) continue;
      const [from, to] = [entry.from, key.split('-').find(pin => pin !== entry.from)];
      const others = [...settled.entries()].filter(([otherKey]) => otherKey !== key).map(([, other]) => other.route).filter(Boolean);
      const route = routeOf(from, to, others, 'r' + round + ':');
      if (route) next.set(key, { route, from });
    }
    settled = next;
    const conflictsNow = countConflicts(crossingConflicts([...settled.entries()].map(([key, entry]) => [key, entry.route])));
    if (conflictsNow < bestConflicts) { bestConflicts = conflictsNow; best = settled; }
    else break;
  }
  settled = best;
  return (from, to) => {
    // A wire already on the board is drawn exactly as it was validated; only a
    // preview (a wire being dragged) is routed on demand.
    const stored = settled.get(geometryWireKey(from, to));
    if (stored) return stored.from === from ? stored.route : stored.route.toReversed();
    return routeOf(from, to, [...settled.values()].map(entry => entry.route).filter(Boolean), 'preview:');
  };
}

export const routePath = route => route.map((point, index) => (index ? 'L' : 'M') + point.x + ' ' + point.y).join('');

// ---------------------------------------------------------------------------
// Crossing hops
// ---------------------------------------------------------------------------
// The router avoids crossings and, on a single-layer board, the ones that remain
// are geometric: the two strokes really do overlap in the plane. A bare crossing
// reads as a junction, so the wire that draws second hops over the other one —
// the ordinary schematic convention. Which wire hops follows the normalised key
// order, so it never depends on the order the wires were created.
const hopRadius = 6;

function segmentCrossings(first, second) {
  const points = [];
  for (let index = 1; index < first.length; index++) {
    for (let step = 1; step < second.length; step++) {
      const point = crossPoint(first[index - 1], first[index], second[step - 1], second[step]);
      if (point) points.push(point);
    }
  }
  return points;
}

// `entries` is a list of [normalised wire key, route]. Returns a Map from key to
// the crossing points that key hops over.
export function crossingHops(entries) {
  const hops = new Map();
  const add = (key, point) => hops.set(key, [...(hops.get(key) || []), point]);
  for (let first = 0; first < entries.length; first++) {
    for (let second = first + 1; second < entries.length; second++) {
      const [keyA, routeA] = entries[first];
      const [keyB, routeB] = entries[second];
      if (!routeA || !routeB || routeA.length < 2 || routeB.length < 2) continue;
      const points = segmentCrossings(routeA, routeB);
      if (!points.length) continue;
      const hopKey = keyA > keyB ? keyA : keyB;
      for (const point of points) add(hopKey, point);
    }
  }
  return hops;
}

// Same polyline, but every marked point becomes a small semicircular hop. A hop
// closer than two radii to the previous one is dropped so the arcs never overlap.
export function routePathWithHops(route, hopPoints = []) {
  if (!hopPoints.length || route.length < 2) return routePath(route);
  let path = 'M' + route[0].x + ' ' + route[0].y;
  for (let index = 1; index < route.length; index++) {
    const from = route[index - 1];
    const to = route[index];
    const horizontal = from.y === to.y;
    const sign = Math.sign(horizontal ? to.x - from.x : to.y - from.y);
    const low = horizontal ? Math.min(from.x, to.x) : Math.min(from.y, to.y);
    const high = horizontal ? Math.max(from.x, to.x) : Math.max(from.y, to.y);
    const along = hopPoints
      .filter(point => (horizontal ? point.y === from.y && point.x > low && point.x < high : point.x === from.x && point.y > low && point.y < high))
      .map(point => (horizontal ? point.x : point.y));
    // Walk the segment in its own drawing direction so the arcs stay in order.
    along.sort((a, b) => (sign >= 0 ? a - b : b - a));
    let previous = null;
    for (const value of along) {
      if (previous !== null && Math.abs(value - previous) < hopRadius * 2) continue;
      previous = value;
      const start = value - sign * hopRadius;
      const end = value + sign * hopRadius;
      if (start < low || end > high) continue;
      const startPoint = horizontal ? { x: start, y: from.y } : { x: from.x, y: start };
      const endPoint = horizontal ? { x: end, y: from.y } : { x: from.x, y: end };
      // A horizontal hop bulges up, a vertical one bulges right; in the SVG
      // y-down plane that is sweep 1 when the segment is drawn forwards.
      path += ' L' + startPoint.x + ' ' + startPoint.y + ' A' + hopRadius + ' ' + hopRadius + ' 0 0 ' + (sign > 0 ? 1 : 0) + ' ' + endPoint.x + ' ' + endPoint.y;
    }
    path += ' L' + to.x + ' ' + to.y;
  }
  return path;
}

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
  const pins = Object.entries(game.placed).flatMap(([id, placed]) => placed ? Object.keys(componentSpec(id)?.terminals || {}) : []);
  for (const target of pins) {
    const pin = pinPosition(game, target);
    if (!pin) continue;
    const distance = Math.hypot(point.x - pin.x, point.y - pin.y);
    if (distance < 37 && distance < best.distance) best = { ...pin, target, wire: null, distance };
  }
  const routeOf = createRouteResolver(game);
  for (const wire of game.wires) {
    const [from, to] = wire.split('-');
    const route = routeOf(from, to);
    if (!route) continue;
    for (let index = 1; index < route.length; index++) {
      const candidate = nearestOnSegment(point, route[index - 1], route[index]);
      if (candidate.distance < 23 && candidate.distance < best.distance) best = { ...candidate, target: from, wire: geometryWireKey(from, to) };
    }
  }
  if (!Number.isFinite(best.distance)) return bounded;
  return { x: Math.round(best.x), y: Math.round(best.y), target: best.target, wire: best.wire };
}
