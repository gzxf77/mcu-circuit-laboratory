import test from 'node:test';
import assert from 'node:assert/strict';
import { geometryWireKey, pinPosition, snapProbe, wireRoute } from '../src/circuitGeometry.js';
import { evaluateCircuit, startGame } from '../src/evaluateCircuit.js';
import { getLevel } from '../src/levels/catalog.js';
import { defaultProbe, readProbe } from '../src/probeModel.js';

const level = getLevel(1);
const measure = (game, target, wire = null) => readProbe(game, evaluateCircuit(game, level), { target, wire }, level);

test('预设电路板在测量前不显示探针波形', () => {
  const game = startGame(false, level);
  assert.equal(defaultProbe.target, null);
  assert.equal(readProbe(game, evaluateCircuit(game, level), null, level).waveform, 'idle');
  assert.equal(snapProbe(game, game.positions.power).target, 'power');
  assert.equal(snapProbe(game, pinPosition(game, 'r1.a')).target, 'r1.a');
});

test('探针读电源、节点与电阻两端电压', () => {
  const game = startGame(true, level);
  assert.equal(measure(game, 'power').voltageV, 12);
  assert.equal(measure(game, 'r1.a').voltageV, 12);
  assert.equal(measure(game, 'r1.a').pointLabel, '节点 A');
  assert.equal(measure(game, 'r1.b').voltageV, 0);
  assert.equal(measure(game, 'ground').voltageV, 0);
  // R1 串在电源与 GND 之间，电流 12 mA。
  assert.equal(measure(game, 'r1.a').currentMa, 12);
  assert.equal(measure(game, 'r1.a').waveform, 'flat');
});

test('导线探针读所在支路电流，不是节点总电流', () => {
  const game = startGame(true, level);
  assert.equal(measure(game, 'power', 'power-r1.a').currentMa, 12);
  assert.equal(measure(game, 'ground').currentMa, 12);
});

test('电源被短接时不给出伪造的零，而是标短路；悬空电阻不读数', () => {
  const shorted = startGame(true, level);
  shorted.wires.push('power-ground');
  assert.equal(measure(shorted, 'power').voltageV, null);
  assert.match(measure(shorted, 'power').voltageLabel, /短路/);
  // 一颗没接线的电阻：两端悬空，不是 0 V。
  const dangling = startGame(false, level);
  dangling.placed = { ...dangling.placed, r2: true };
  dangling.resistorValues = { ...dangling.resistorValues, r2: 1000 };
  assert.equal(measure(dangling, 'r2.a').voltageV, null);
  assert.match(measure(dangling, 'r2.a').voltageLabel, /悬空/);
});

test('探针吸附跟随已放置电阻端子与导线', () => {
  const game = startGame(true, level);
  const pin = pinPosition(game, 'r1.a');
  assert.equal(snapProbe(game, pin).target, 'r1.a');
  const route = wireRoute(pinPosition(game, 'r1.a'), pinPosition(game, 'r1.b'), geometryWireKey('r1.a', 'r1.b'), 'r1');
  const near = { x: route[0].x + 6, y: route[0].y };
  assert.ok(snapProbe(game, near).target);
  game.placed.r1 = false;
  assert.notEqual(snapProbe(game, pin).target, 'r1.a');
});
