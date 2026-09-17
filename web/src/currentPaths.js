import { electricalFor, estimateSeriesCurrentMa } from './levelElectrical.js';
import { defaultLevel } from './levels/catalog.js';

const componentOf = endpoint => endpoint.split('.')[0];

// Trace copper only. Resistors and LEDs are crossed explicitly below, so an
// open component never makes two otherwise separate wire nets appear joined.
export function wirePath(game, start, end) {
  if (!game.placed[componentOf(start)] || !game.placed[componentOf(end)]) return null;
  if (start === end) return [];
  const neighbors = new Map();
  for (const wire of game.wires) {
    const [a, b] = wire.split('-');
    if (!game.placed[componentOf(a)] || !game.placed[componentOf(b)]) continue;
    if (!neighbors.has(a)) neighbors.set(a, []);
    if (!neighbors.has(b)) neighbors.set(b, []);
    neighbors.get(a).push(b);
    neighbors.get(b).push(a);
  }
  const parent = new Map([[start, null]]);
  const queue = [start];
  for (let index = 0; index < queue.length; index++) {
    const node = queue[index];
    for (const next of neighbors.get(node) || []) {
      if (parent.has(next)) continue;
      parent.set(next, node);
      if (next === end) {
        const path = [];
        for (let current = end; parent.get(current) !== null; current = parent.get(current)) {
          path.unshift([parent.get(current), current]);
        }
        return path;
      }
      queue.push(next);
    }
  }
  return null;
}

export function detectCurrentPath(game, supply, level = defaultLevel) {
  const c = level.circuit;
  const e = electricalFor(game, level);
  const [resistorA, resistorB] = c.resistor;
  const [ledA, ledB] = c.led;
  if (!game.placed.ground || !game.placed.resistor || !Number.isFinite(e.resistorOhms) || e.resistorOhms <= 0) return null;
  if (wirePath(game, c.supply, c.ground) || (supply && wirePath(game, c.gpio, c.ground))) return null;

  const sources = supply ? [c.gpio, c.supply] : [c.supply];
  for (const source of sources) {
    for (const [input, output] of [[resistorA, resistorB], [resistorB, resistorA]]) {
      const incoming = wirePath(game, source, input);
      if (!incoming?.length) continue;

      const ledAnode = game.reversed ? ledB : ledA;
      const ledCathode = game.reversed ? ledA : ledB;
      const toLed = game.placed.led && wirePath(game, output, ledAnode);
      const fromLed = game.placed.led && wirePath(game, ledCathode, c.ground);
      const directGround = wirePath(game, output, c.ground);
      const throughLed = Boolean(!directGround?.length && toLed?.length && fromLed?.length);
      if (!throughLed && !directGround?.length) continue;

      const flowEdges = [
        ...(source === c.gpio ? wirePath(game, c.supply, c.mcuVdd) || [] : []),
        ...incoming,
        ...(throughLed ? [...toLed, ...fromLed] : directGround),
        ...(source === c.gpio ? wirePath(game, c.ground, c.mcuGround) || [] : []),
      ];
      const currentMa = throughLed ? estimateSeriesCurrentMa(e) : e.gpioHighV / e.resistorOhms * 1000;
      const sourceName = source === c.gpio ? 'GPIO0' : e.gpioHighV.toFixed(1) + ' V 电源';
      return {
        kind: throughLed ? 'led-series' : 'resistor-only',
        currentMa,
        resistorPowerW: (currentMa / 1000) ** 2 * e.resistorOhms,
        currentLabel: '约 ' + currentMa.toFixed(1) + ' mA',
        flowEdges,
        resistorDirection: input === resistorA ? 'forward' : 'reverse',
        flowLabel: sourceName + ' → 电阻 → ' + (throughLed ? 'LED → ' : '') + 'GND',
        detail: throughLed
          ? '电阻与 LED 串联；本关按 (' + e.gpioHighV.toFixed(1) + ' − ' + e.ledForwardV.toFixed(1) + ') V ÷ ' + e.resistorOhms + ' Ω 估算。'
          : sourceName + ' 经 ' + e.resistorOhms + ' Ω 电阻回到 GND，约 ' + e.gpioHighV.toFixed(1) + ' V ÷ ' + e.resistorOhms + ' Ω = ' + currentMa.toFixed(1) + ' mA；LED 没有流过这条电流。',
      };
    }
  }
  return null;
}
