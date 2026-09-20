import test from 'node:test';
import assert from 'node:assert/strict';
import { boardGrid, clearRouteCache, clientPointInSvg, componentObstacles, createRouteResolver, crossingHops, geometryWireKey, pinPosition, routePathWithHops, snapComponentPosition, snapProbe, terminalAtPoint, wireRoute } from '../src/circuitGeometry.js';
import { componentSpec, nextResistorId } from '../src/componentCatalog.js';
import { evaluateCircuit, startGame } from '../src/evaluateCircuit.js';
import { getLevel } from '../src/levels/catalog.js';

// Drawn extent of each symbol (tighter than visualBounds, which also reserves
// room for value labels). A wire inside one of these boxes overlaps real ink.
const inkExtents = {
  power: [-25, 25, -73, 0], ground: [-25, 25, 0, 96], nodeA: [-30, 30, -45, 26],
  resistor: [-70, 70, -49, 15], isource: [-70, 70, -70, 34],
  led: [-63, 63, -51, 78], mcu: [-100, 100, -127, 128],
};
const extentsOf = (id, source) => source === 'ink'
  ? inkExtents[id] || inkExtents.resistor
  : componentSpec(id).visualBounds;
const boxOf = (id, position, pad = 0, source = 'visual') => {
  const [minX, maxX, minY, maxY] = extentsOf(id, source);
  return { id, minX: position.x + minX - pad, maxX: position.x + maxX + pad, minY: position.y + minY - pad, maxY: position.y + maxY + pad };
};
const insideLength = (from, to, rect) => {
  if (from.x === to.x) {
    if (from.x <= rect.minX || from.x >= rect.maxX) return 0;
    return Math.max(0, Math.min(Math.max(from.y, to.y), rect.maxY) - Math.max(Math.min(from.y, to.y), rect.minY));
  }
  if (from.y === to.y) {
    if (from.y <= rect.minY || from.y >= rect.maxY) return 0;
    return Math.max(0, Math.min(Math.max(from.x, to.x), rect.maxX) - Math.max(Math.min(from.x, to.x), rect.minX));
  }
  return 0;
};
const routeLength = route => route.slice(1).reduce((sum, point, index) => sum + Math.abs(point.x - route[index].x) + Math.abs(point.y - route[index].y), 0);
const crossingIds = (route, rects) => rects
  .filter(rect => route.slice(1).reduce((sum, point, index) => sum + insideLength(route[index], point, rect), 0) > 0.5)
  .map(rect => rect.id);
const placedIds = game => Object.keys(game.placed).filter(id => game.placed[id]);
const routeBetween = (game, from, to, source = 'visual') => wireRoute(
  pinPosition(game, from), pinPosition(game, to), geometryWireKey(from, to), from,
  placedIds(game).map(id => boxOf(id, game.positions[id], 0, source)),
);

test('inventory drop uses the rendered board bounds and zoomed viewBox', () => {
  assert.deepEqual(
    clientPointInSvg(
      { x: 600, y: 425 },
      { left: 300, top: 200, width: 600, height: 450 },
      { x: -50, y: 25, width: 1000, height: 750 },
    ),
    { x: 450, y: 400 },
  );
});

test('component movement and placement snap to the same holes as the board pattern', () => {
  const position = snapComponentPosition('resistor', { x: 461, y: 331 });
  assert.equal((position.x - boardGrid.offset) % boardGrid.step, 0);
  assert.equal((position.y - boardGrid.offset) % boardGrid.step, 0);
  assert.deepEqual(snapComponentPosition('resistor', { x: position.x + 8, y: position.y - 8 }), position);
  const edge = snapComponentPosition('mcu', { x: 9999, y: -9999 });
  assert.ok(edge.x <= 685 && edge.y >= 260);
  assert.equal((edge.x - boardGrid.offset) % boardGrid.step, 0);
});

test('dragged wire finds only nearby placed terminals at the pointer release', () => {
  const game = startGame(false);
  game.placed.r1 = true;
  game.placed.power = true;
  const start = pinPosition(game, 'r1.a');
  const target = pinPosition(game, 'power');
  assert.equal(terminalAtPoint(game, { x: target.x + 8, y: target.y - 6 }, 'r1.a'), 'power');
  assert.equal(terminalAtPoint(game, start, 'r1.a'), null);
  assert.equal(terminalAtPoint(game, { x: target.x + 40, y: target.y }, 'r1.a'), null);
  game.placed.power = false;
  assert.equal(terminalAtPoint(game, target, 'r1.a'), null);
});

test('a right terminal exits right before routing to a component placed on its left', () => {
  const resistor = { x: 500, y: 170 };
  const led = { x: 430, y: 300 };
  const key = geometryWireKey('resistor.b', 'led.a');
  const forward = wireRoute(resistor, led, key, 'resistor.b');
  const backward = wireRoute(led, resistor, key, 'led.a');

  assert.deepEqual(forward[0], resistor);
  assert.ok(forward[1].x > resistor.x);
  assert.ok(forward.at(-2).x < led.x);
  assert.deepEqual(forward.at(-1), led);
  assert.deepEqual(backward, forward.toReversed());
});

test('an LED right terminal does not fold back through the LED when GND is on the left', () => {
  const led = { x: 665, y: 213 };
  const ground = { x: 266, y: 448 };
  const key = geometryWireKey('led.b', 'ground');
  const route = wireRoute(led, ground, key, 'led.b');

  assert.ok(route[1].x > led.x, 'leaves the right terminal to the right');
  assert.deepEqual(route.at(-1), ground);
  assert.deepEqual(wireRoute(ground, led, key, 'ground'), route.toReversed());
  // Everything after the exit stub must stay clear of the LED's own body: the
  // old failure mode was the wire folding back across the symbol.
  assert.deepEqual(crossingIds(route.slice(1), [{ id: 'led', minX: 541, maxX: 667, minY: 157, maxY: 291 }]), []);
  assert.ok(routeLength(route) <= Math.abs(led.x - ground.x) + Math.abs(led.y - ground.y) + 40,
    'detours without need: ' + routeLength(route));
});

test('a wire between two terminals on one row leaves straight to the side', () => {
  // The reported case: the source pin and R1's left terminal share a row, so the
  // wire must leave the source sideways instead of dropping below its symbol.
  const game = levelOneBoard();
  game.positions = { ...game.positions, r1: { x: 345, y: 187 } };
  assert.deepEqual(pinPosition(game, 'power'), { x: 175, y: 187 });
  assert.deepEqual(pinPosition(game, 'r1.a'), { x: 275, y: 187 });
  const route = routeBetween(game, 'power', 'r1.a');
  assert.deepEqual(route, [{ x: 175, y: 187 }, { x: 275, y: 187 }], 'expected one straight segment');
  assert.deepEqual(routeBetween(game, 'r1.a', 'power'), route.toReversed());
});

test('a normally ordered resistor to LED wire keeps its short route', () => {
  const resistor = { x: 328, y: 94 };
  const led = { x: 454, y: 213 };
  const route = wireRoute(resistor, led, geometryWireKey('resistor.b', 'led.a'), 'resistor.b');

  assert.deepEqual(route, [resistor, { x: 391, y: 94 }, { x: 391, y: 213 }, led]);
});

const levelOneBoard = () => {
  const level = getLevel(1);
  const game = startGame(true, level);
  game.positions = { ...level.board.positions };
  game.placed = { ...game.placed, r1: true, r2: true };
  return game;
};

test('resistor ids past r4 get real geometry instead of crashing the board', () => {
  assert.deepEqual(componentSpec('r5').terminals, { 'r5.a': { x: -70, y: 0 }, 'r5.b': { x: 70, y: 0 } });
  assert.deepEqual(componentSpec('r12').visualBounds, componentSpec('r1').visualBounds);
  assert.equal(componentSpec('ghost'), undefined);

  // A player can drop more resistors than any static list covers: the fifth one
  // must snap, probe, route and evaluate exactly like the first.
  const game = levelOneBoard();
  game.placed.r4 = true;
  game.placed.r5 = true;
  game.positions.r4 = { x: 200, y: 500 };
  game.positions.r5 = { x: 300, y: 500 };
  game.resistorValues.r5 = 1000;
  game.wires = [...game.wires, 'r5.a-power'];
  assert.deepEqual(pinPosition(game, 'r5.a'), { x: 230, y: 500 });
  assert.equal(pinPosition(game, 'r9.b'), null);
  assert.equal(terminalAtPoint(game, { x: 230, y: 500 }, 'r1.a'), 'r5.a');
  assert.equal(snapProbe(game, { x: 236, y: 500 }).target, 'r5.a');
  const route = routeBetween(game, 'r5.a', 'power');
  assert.deepEqual(route[0], { x: 230, y: 500 });
  assert.deepEqual(route.at(-1), { x: 175, y: 187 });
  assert.ok(route.length >= 2);
  assert.equal(evaluateCircuit(game, getLevel(1)).network.resistorResults.r5.ohms, 1000);
});

test('a sandbox board supports as many library components as the player drops', () => {
  const level = getLevel(1);
  const game = startGame(true, level);
  game.positions = { ...level.board.positions };
  game.placed = { ...game.placed };
  // Twelve resistors charted around the fixed parts: three times the old r1–r4
  // table that used to decide which resistor ids existed.
  const ids = [];
  let n = 0;
  for (const y of [250, 410, 560]) {
    for (const x of [120, 300, 480, 660]) {
      n += 1;
      const id = 'r' + n;
      ids.push(id);
      game.placed[id] = true;
      game.resistorValues[id] = 1000;
      game.positions[id] = { x, y };
    }
  }
  assert.equal(ids.length, 12);

  for (const id of ids) {
    const position = game.positions[id];
    assert.deepEqual(pinPosition(game, id + '.a'), { x: position.x - 70, y: position.y }, id + ' left terminal');
    assert.deepEqual(pinPosition(game, id + '.b'), { x: position.x + 70, y: position.y }, id + ' right terminal');
    assert.equal(terminalAtPoint(game, { x: position.x - 70, y: position.y }, null), id + '.a');
    assert.equal(snapProbe(game, { x: position.x - 70, y: position.y }).target, id + '.a');
  }

  const obstacles = componentObstacles(game);
  assert.equal(obstacles.filter(rect => /^r\d+$/.test(rect.id)).length, ids.length);
  assert.equal(obstacles.filter(rect => rect.id === 'r12').length, 1);

  // A long wire threading the new parts must still keep clear of every symbol,
  // and each of them must be routable from both directions.
  const inkRects = ids.map(id => boxOf(id, game.positions[id], 0, 'ink'));
  assert.deepEqual(crossingIds(routeBetween(game, 'power', 'ground'), inkRects), []);
  for (const id of [ids[0], ids[5], ids.at(-1)]) {
    const route = routeBetween(game, 'ground', id + '.a');
    assert.deepEqual(route.at(-1), { x: game.positions[id].x - 70, y: game.positions[id].y });
    assert.deepEqual(routeBetween(game, id + '.a', 'ground'), route.toReversed(), id + ' is direction stable');
  }
  const report = evaluateCircuit(game, level);
  for (const id of ids) assert.equal(report.network.resistorResults[id].ohms, 1000, id + ' is in the network');
  for (const id of ['r1', 'r2']) assert.equal(report.componentStates[id].state, 'conducting', id + ' carries the solved circuit');
  for (const id of ['r4', 'r12']) assert.equal(report.componentStates[id].state, 'normal', id + ' is placed but unwired');
});

test('library part ids are allocated without any component-count limit', () => {
  const placed = {};
  const ids = [];
  for (let index = 0; index < 30; index++) {
    const id = nextResistorId(placed);
    ids.push(id);
    placed[id] = true;
  }
  assert.deepEqual(ids.slice(0, 5), ['r1', 'r2', 'r3', 'r4', 'r5']);
  assert.equal(ids.at(-1), 'r30');
  assert.equal(new Set(ids).size, 30);
  // Deleting a part frees its number again without disturbing the rest.
  placed.r3 = false;
  assert.equal(nextResistorId(placed), 'r3');
});

test('a densely populated sandbox board never routes a wire through a symbol', () => {
  const level = getLevel(1);
  const game = startGame(true, level);
  game.positions = { ...level.board.positions };
  game.placed = { ...game.placed };
  const occupied = ['power', 'isource', 'nodeA', 'ground'].map(id => boxOf(id, game.positions[id]));
  const slots = [];
  for (const y of [170, 300, 430, 560]) for (const x of [110, 280, 450, 620, 800]) slots.push({ x, y });
  let placed = 0;
  for (const slot of slots) {
    const candidate = boxOf('resistor', slot, 0);
    if (occupied.some(rect => rect.minX < candidate.maxX && rect.maxX > candidate.minX && rect.minY < candidate.maxY && rect.maxY > candidate.minY)) continue;
    placed += 1;
    const id = 'r' + placed;
    game.placed[id] = true;
    game.resistorValues[id] = 1000;
    game.positions[id] = slot;
    occupied.push(candidate);
  }
  assert.ok(placed >= 8, 'expected a crowded board, placed ' + placed);

  const ids = Object.keys(game.placed).filter(id => game.placed[id]);
  const pins = ids.flatMap(id => Object.keys(componentSpec(id).terminals));
  const inkRects = ids.map(id => boxOf(id, game.positions[id], 0, 'ink'));
  const routeOf = createRouteResolver(game);
  let routed = 0;
  for (let first = 0; first < pins.length; first++) {
    for (let second = first + 1; second < pins.length; second++) {
      const from = pins[first];
      const to = pins[second];
      if (from.split('.')[0] === to.split('.')[0]) continue;
      const own = [from.split('.')[0], to.split('.')[0]];
      const others = inkRects.filter(rect => !own.includes(rect.id));
      const route = routeOf(from, to);
      assert.ok(route && route.length >= 2, from + ' -> ' + to + ' has no route');
      assert.deepEqual(crossingIds(route, others), [], from + ' -> ' + to + ' crosses a symbol');
      assert.deepEqual(routeOf(to, from), route.toReversed(), from + ' -> ' + to + ' is direction stable');
      routed += 1;
    }
  }
  assert.ok(routed > 100, 'expected many wire pairs, routed ' + routed);
});

test('a terminal outside the corridor area still gets a route', () => {
  const game = levelOneBoard();
  // Reachable pins sit on component edges; a part dropped at the extreme left
  // puts its terminal at the very border, and the grid must still contain it.
  game.placed.r4 = true;
  game.resistorValues.r4 = 1000;
  game.positions.r4 = { x: 20, y: 323 };
  assert.deepEqual(pinPosition(game, 'r4.a'), { x: -50, y: 323 });
  const route = routeBetween(game, 'r4.a', 'ground');
  assert.ok(route && route.length >= 2);
  assert.deepEqual(route[0], { x: -50, y: 323 });
  assert.deepEqual(route.at(-1), { x: 790, y: 527 });
  assert.deepEqual(routeBetween(game, 'ground', 'r4.a'), route.toReversed());
});

test('the route resolver is stable and follows geometry changes', () => {
  clearRouteCache();
  const game = levelOneBoard();
  const routeOf = createRouteResolver(game);
  const first = routeOf('power', 'nodeA');
  assert.ok(first && first.length >= 2);
  assert.deepEqual(routeOf('power', 'nodeA'), first, 'repeat lookups are stable');
  assert.deepEqual(routeOf('nodeA', 'power'), first.toReversed(), 'both directions agree');
  assert.equal(routeOf('power', 'r9.b'), null, 'missing pins resolve to null');
  // Moving a part must produce fresh routes rather than the stale cached ones:
  // r1 is dropped right onto the corridor this wire uses.
  const moved = { ...game, positions: { ...game.positions, r1: { x: 250, y: 323 } } };
  const movedRoute = createRouteResolver(moved)('power', 'nodeA');
  assert.notDeepEqual(movedRoute, first, 'the moved part forces a detour');
  assert.deepEqual(movedRoute, createRouteResolver(moved)('power', 'nodeA'), 'and the detour is stable');
  // Removing a part changes the obstacles and therefore the route as well.
  const withoutR2 = { ...game, placed: { ...game.placed, r2: false } };
  assert.deepEqual(createRouteResolver(withoutR2)('power', 'nodeA'), createRouteResolver(withoutR2)('power', 'nodeA'));
});

test('wires avoid crossing each other when a clear route exists', () => {
  // A multi-wire reference build: the load is fed by a parallel pair of series
  // resistors, and routing those without looking at each other crosses them,
  // which reads like a junction.
  const level = getLevel(3);
  const game = startGame(true, level);
  game.positions = { ...level.board.positions };
  game.placed = { ...game.placed, r1: true, r2: true, r3: true };
  const routeOf = createRouteResolver(game);
  const routes = game.wires.map(wire => { const [from, to] = wire.split('-'); return { wire, route: routeOf(from, to) }; });
  const crosses = (a, b, c, d) => {
    const aVertical = a.x === b.x;
    const cVertical = c.x === d.x;
    if (aVertical === cVertical) return false;
    const [vs, ve] = aVertical ? [a, b] : [c, d];
    const [hs, he] = aVertical ? [c, d] : [a, b];
    return vs.x > Math.min(hs.x, he.x) && vs.x < Math.max(hs.x, he.x)
      && hs.y > Math.min(vs.y, ve.y) && hs.y < Math.max(vs.y, ve.y);
  };
  const conflicts = [];
  for (let first = 0; first < routes.length; first++) {
    for (let second = first + 1; second < routes.length; second++) {
      for (let i = 1; i < routes[first].route.length; i++) {
        for (let j = 1; j < routes[second].route.length; j++) {
          if (crosses(routes[first].route[i - 1], routes[first].route[i], routes[second].route[j - 1], routes[second].route[j])) {
            conflicts.push(routes[first].wire + ' × ' + routes[second].wire);
          }
        }
      }
    }
  }
  assert.deepEqual(conflicts, [], 'wires cross: ' + conflicts.join(', '));
});

test('a crossing the single layer cannot remove is drawn as a hop, not a junction', () => {
  // Two straight wires that must cross: the hop belongs to the wire with the
  // larger normalised key, so both wires agree on who goes over, whichever order
  // they are listed in.
  const left = { key: 'a.b-c.d', route: [{ x: 0, y: 50 }, { x: 100, y: 50 }] };
  const right = { key: 'a.b-e.f', route: [{ x: 50, y: 0 }, { x: 50, y: 100 }] };
  const hops = crossingHops([[left.key, left.route], [right.key, right.route]]);
  const expected = crossingHops([[right.key, right.route], [left.key, left.route]]);
  assert.deepEqual(hops.get('a.b-e.f'), [{ x: 50, y: 50 }]);
  assert.equal(hops.has('a.b-c.d'), false);
  assert.deepEqual(expected.get('a.b-e.f'), hops.get('a.b-e.f'));
  const path = routePathWithHops(right.route, hops.get('a.b-e.f'));
  // A vertical hop bulges right in the SVG y-down plane, a horizontal one bulges
  // up; both are sweep 1 while the segment is drawn in its positive direction.
  assert.match(path, /^M50 0 L50 44 A6 6 0 0 1 50 56 L50 100$/, path);
  // A wire with nothing on it keeps its plain polyline.
  assert.equal(routePathWithHops(left.route, []), 'M0 50L100 50');
});

test('geometry ignores a placed component with no registered shape', () => {
  const game = { ...levelOneBoard(), placed: { ...levelOneBoard().placed, ghost: true }, positions: { ...levelOneBoard().positions, ghost: { x: 400, y: 400 } } };
  assert.equal(pinPosition(game, 'ghost.a'), null);
  assert.equal(terminalAtPoint(game, { x: 400, y: 400 }), null);
  assert.equal(snapProbe(game, { x: 400, y: 400 }).target, null);
  assert.ok(!componentObstacles(game).some(rect => rect.id === 'ghost'));
});

test('every placed component is treated as a routing obstacle', () => {
  const game = levelOneBoard();
  const obstacles = componentObstacles(game);
  assert.deepEqual(obstacles.map(rect => rect.id).sort(), ['ground', 'isource', 'nodeA', 'power', 'r1', 'r2']);
  for (const rect of obstacles) {
    const [minX, maxX, minY, maxY] = componentSpec(rect.id).visualBounds;
    const position = game.positions[rect.id];
    assert.equal(rect.minX, position.x + minX);
    assert.equal(rect.maxY, position.y + maxY);
  }
  game.placed.r2 = false;
  assert.ok(!componentObstacles(game).some(rect => rect.id === 'r2'));
});

test('the solved level 1 wires clear every component they are not attached to', () => {
  const level = getLevel(1);
  const game = levelOneBoard();
  for (const wire of level.circuit.solutionWires) {
    const [from, to] = wire.split('-');
    const own = [from.split('.')[0], to.split('.')[0]];
    const others = placedIds(game).filter(id => !own.includes(id)).map(id => boxOf(id, game.positions[id]));
    const route = routeBetween(game, from, to);
    assert.deepEqual(crossingIds(route, others), [], wire + ' crosses ' + JSON.stringify(route));
    const direct = Math.abs(route[0].x - route.at(-1).x) + Math.abs(route[0].y - route.at(-1).y);
    assert.ok(routeLength(route) <= direct + 60, wire + ' detours without need');
    assert.deepEqual(routeBetween(game, to, from), route.toReversed(), wire + ' is direction stable');
  }
});

test('a long wire routes around the components standing in its way', () => {
  const game = levelOneBoard();
  // Drawn straight from power to r2.b, these wires used to cut through r2 and
  // node A; they must now go around them.
  const rects = ['r2', 'nodeA'].map(id => boxOf(id, game.positions[id]));
  assert.deepEqual(crossingIds(routeBetween(game, 'power', 'ground'), rects), []);
  assert.deepEqual(crossingIds(routeBetween(game, 'ground', 'r1.a'), rects), []);
});

test('randomly laid out boards never run a wire through a drawn symbol', () => {
  const level = getLevel(1);
  const pins = ['power', 'isource.in', 'isource.out', 'nodeA', 'ground', 'r1.a', 'r1.b', 'r2.a', 'r2.b'];
  const columns = [];
  for (let x = 110; x <= 800; x += 68) columns.push(x);
  const rows = [];
  for (let y = 150; y <= 560; y += 68) rows.push(y);
  let seed = 20260920;
  const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const overlaps = (left, right) =>
    Math.min(left.maxX, right.maxX) - Math.max(left.minX, right.minX) > 0 &&
    Math.min(left.maxY, right.maxY) - Math.max(left.minY, right.minY) > 0;

  let layouts = 0;
  for (let round = 0; round < 400 && layouts < 40; round++) {
    const game = levelOneBoard();
    for (const id of ['r1', 'r2']) {
      game.positions[id] = { x: columns[Math.floor(random() * columns.length)], y: rows[Math.floor(random() * rows.length)] };
    }
    const ids = placedIds(game);
    const bodies = ids.map(id => boxOf(id, game.positions[id], 8));
    let usable = true;
    for (let left = 0; left < bodies.length && usable; left++) {
      for (let right = left + 1; right < bodies.length; right++) {
        if (overlaps(bodies[left], bodies[right])) { usable = false; break; }
      }
    }
    if (!usable) continue;
    layouts += 1;
    const inkRects = ids.map(id => boxOf(id, game.positions[id], 0, 'ink'));
    for (let first = 0; first < pins.length; first++) {
      for (let second = first + 1; second < pins.length; second++) {
        const from = pins[first];
        const to = pins[second];
        if (from.split('.')[0] === to.split('.')[0]) continue;
        const own = [from.split('.')[0], to.split('.')[0]];
        const others = inkRects.filter(rect => !own.includes(rect.id));
        const route = routeBetween(game, from, to);
        assert.deepEqual(crossingIds(route, others), [], from + ' -> ' + to + ' crosses a symbol in ' + JSON.stringify(game.positions));
        assert.deepEqual(routeBetween(game, to, from), route.toReversed(), from + ' -> ' + to + ' is direction stable');
      }
    }
  }
  assert.equal(layouts, 40, 'expected 40 usable random layouts');
});
