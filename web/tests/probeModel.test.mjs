import test from 'node:test';
import assert from 'node:assert/strict';
import { geometryWireKey, pinPosition, snapProbe, wireRoute } from '../src/circuitGeometry.js';
import { evaluateCircuit, startGame } from '../src/evaluateCircuit.js';
import { getLevel } from '../src/levels/catalog.js';
import { defaultProbe, readProbe } from '../src/probeModel.js';

const measure = (game, target, wire = null) => readProbe(game, evaluateCircuit(game), { target, wire });

test('the preset course board shows no probe trace before measurement', () => {
  const game = startGame();
  assert.equal(defaultProbe.target, null);
  assert.equal(readProbe(game, evaluateCircuit(game), null).waveform, 'idle');
  assert.equal(snapProbe(game, { x: 175, y: 187 }).target, 'power');
  assert.equal(snapProbe(game, game.positions.nodeA).target, 'nodeA');
});

test('probe reads source, node, branch and reference voltages', () => {
  const game = startGame(true);
  assert.equal(measure(game, 'power').voltageV, 12);
  assert.equal(measure(game, 'r1.b').voltageV, 3);
  assert.equal(measure(game, 'nodeA').voltageV, 3);
  assert.equal(measure(game, 'nodeA').pointLabel, '节点 A');
  assert.match(measure(game, 'r2.a').pointLabel, /节点 A/);
  assert.equal(measure(game, 'r2.a').voltageV, 3);
  assert.equal(measure(game, 'r2.b').voltageV, 0);
  assert.equal(measure(game, 'ground').voltageV, 0);
  assert.equal(measure(game, 'r1.b').currentMa, 9);
  assert.equal(measure(game, 'r2.a').currentMa, 3);
  assert.equal(measure(game, 'isource.in').voltageV, 3);
  assert.equal(measure(game, 'r2.a').waveform, 'flat');
});

test('wire probe uses its branch current rather than total node current', () => {
  const game = startGame(true);
  assert.equal(measure(game, 'nodeA', 'nodeA-r2.a').currentMa, 3);
  assert.equal(measure(game, 'nodeA', 'nodeA-r1.b').currentMa, 9);
  assert.equal(measure(game, 'power', 'power-r1.a').currentMa, 9);
});

test('floating and shorted nodes never display a measured zero', () => {
  const game = startGame(true);
  game.wires = game.wires.filter(wire => wire !== 'power-r1.a');
  // R1 now carries no current, so both of its terminals sit at node A's −6 V —
  // never at a fabricated 0 V. A resistor with no wire at all stays floating.
  assert.equal(measure(game, 'r1.a').voltageV, -6);
  assert.equal(measure(game, 'r1.b').voltageV, -6);
  const dangling = startGame(true);
  dangling.wires = dangling.wires.filter(wire => !wire.startsWith('power-r1') && wire !== 'r1.b-nodeA');
  assert.equal(measure(dangling, 'r1.a').voltageV, null);
  assert.match(measure(dangling, 'r1.a').voltageLabel, /悬空/);
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

test('the controlled-source level labels both nodes and reads the control relationship', () => {
  const level = getLevel(2);
  const game = startGame(true, level);
  const report = evaluateCircuit(game, level);
  const at = (target, wire = null) => readProbe(game, report, { target, wire }, level);
  assert.equal(at('vccs.out').pointLabel, '受控源流出端');
  assert.equal(at('vccs.in').pointLabel, '受控源流回端');
  assert.equal(at('nodeA').pointLabel, '节点 A');
  assert.equal(at('nodeB').pointLabel, '节点 B');
  assert.equal(at('r2.b').pointLabel, '节点 B（R2 右端）');
  assert.equal(at('nodeA').voltageV, 7.2);
  assert.equal(at('r1.b').voltageV, 7.2);
  assert.ok(Math.abs(at('nodeB').voltageV - 3.6) < 0.001, 'node B voltage');
  assert.equal(at('r3.b').voltageV, 0);
  assert.equal(at('nodeB').waveform, 'flat');
  assert.ok(Math.abs(at('r1.b').currentMa - 1.8) < 0.001, 'R1 current');
  assert.ok(Math.abs(at('r2.a').currentMa - 3.6) < 0.001, 'R2 current');
  assert.ok(Math.abs(at('r3.a').currentMa - 3.6) < 0.001, 'R3 current');
  assert.ok(Math.abs(at('vccs.out').currentMa - 1.8) < 0.001, 'controlled source current');
  // Break the controlled source's return path and it stops driving: node B falls
  // back to the plain ladder value instead of showing a fake output.
  const openLoop = { ...game, wires: game.wires.filter(wire => wire !== 'vccs.in-ground') };
  const openReport = evaluateCircuit(openLoop, level);
  const openReading = readProbe(openLoop, openReport, { target: 'nodeB' }, level);
  assert.equal(openReport.network.controlledSourceCurrentMa, null);
  assert.ok(Math.abs(openReading.voltageV - 3) < 0.001, 'ladder value without the controlled source');
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
