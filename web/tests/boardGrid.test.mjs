import test from 'node:test';
import assert from 'node:assert/strict';
import { boardGrid, clientPointInSvg, geometryWireKey, snapComponentPosition, wireRoute } from '../src/circuitGeometry.js';

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

  assert.ok(route[1].x > led.x);
  assert.ok(route[2].y > 291 && route[2].y < 436);
  assert.deepEqual(route.at(-1), ground);
  assert.deepEqual(wireRoute(ground, led, key, 'ground'), route.toReversed());
});

test('a normally ordered resistor to LED wire keeps its short route', () => {
  const resistor = { x: 328, y: 94 };
  const led = { x: 454, y: 213 };
  const route = wireRoute(resistor, led, geometryWireKey('resistor.b', 'led.a'), 'resistor.b');

  assert.deepEqual(route, [resistor, { x: 391, y: 94 }, { x: 391, y: 213 }, led]);
});
