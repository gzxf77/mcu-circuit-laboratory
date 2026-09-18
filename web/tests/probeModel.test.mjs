import test from 'node:test';
import assert from 'node:assert/strict';
import { geometryWireKey, pinPosition, snapProbe, wireRoute } from '../src/circuitGeometry.js';
import { evaluateCircuit, startGame } from '../src/evaluateCircuit.js';
import { defaultProbe, readProbe } from '../src/probeModel.js';

const measure = (game, target, wire = null) => readProbe(game, evaluateCircuit(game), { target, wire });

test('the preset course board shows no probe trace before measurement', () => {
  const game = startGame();
  assert.equal(defaultProbe.target, null);
  assert.equal(readProbe(game, evaluateCircuit(game), null).waveform, 'idle');
  assert.equal(snapProbe(game, game.positions.power).target, 'power');
  assert.equal(snapProbe(game, game.positions.nodeA).target, 'nodeA');
});

test('probe reads source, node, branch and reference voltages', () => {
  const game = startGame(true);
  assert.equal(measure(game, 'power').voltageV, 9);
  assert.equal(measure(game, 'r1.b').voltageV, 4.5);
  assert.equal(measure(game, 'nodeA').voltageV, 4.5);
  assert.equal(measure(game, 'nodeA').currentMa, 4.5);
  assert.equal(measure(game, 'nodeA').pointLabel, '节点 A');
  assert.match(measure(game, 'r2.a').pointLabel, /节点 A/);
  assert.equal(measure(game, 'r2.a').voltageV, 4.5);
  assert.equal(measure(game, 'r2.b').voltageV, 0);
  assert.equal(measure(game, 'ground').voltageV, 0);
  assert.equal(measure(game, 'r1.b').currentMa, 4.5);
  assert.equal(measure(game, 'r2.a').currentMa, 4.5);
  assert.equal(measure(game, 'r2.a').waveform, 'flat');
});

test('wire probe agrees with the same current on both series segments', () => {
  const game = startGame(true);
  assert.equal(measure(game, 'nodeA', 'nodeA-r1.b').currentMa, 4.5);
  assert.equal(measure(game, 'nodeA', 'nodeA-r2.a').currentMa, 4.5);
  assert.equal(measure(game, 'power', 'power-r1.a').currentMa, 4.5);
});

test('floating and shorted nodes never display a measured zero', () => {
  const game = startGame(true);
  game.wires = game.wires.filter(wire => wire !== 'power-r1.a');
  assert.equal(measure(game, 'r1.b').voltageV, 0);
  assert.equal(measure(game, 'r1.a').voltageV, 0);
  const detached = startGame();
  detached.placed.r1 = true;
  detached.resistorValues.r1 = 1000;
  assert.equal(measure(detached, 'r1.a').voltageV, null);
  assert.match(measure(detached, 'r1.a').voltageLabel, /悬空/);
  const shorted = startGame(true);
  shorted.wires.push('power-ground');
  assert.equal(measure(shorted, 'power').voltageV, null);
  assert.equal(measure(shorted, 'power').voltageLabel, '短路');
});

test('probe snapping follows placed resistor terminals and wires', () => {
  const game = startGame(true);
  const pin = pinPosition(game, 'r2.a');
  assert.equal(snapProbe(game, pin).target, 'r2.a');
  const route = wireRoute(pinPosition(game, 'nodeA'), pinPosition(game, 'r2.a'), geometryWireKey('nodeA', 'r2.a'), 'nodeA');
  const wire = snapProbe(game, { x: (route[0].x + route[1].x) / 2, y: (route[0].y + route[1].y) / 2 });
  assert.ok(wire.target);
  game.placed.r2 = false;
  assert.notEqual(snapProbe(game, pin).target, 'r2.a');
});
