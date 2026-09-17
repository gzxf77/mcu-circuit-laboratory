import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCircuit, startGame } from '../src/evaluateCircuit.js';
import { readProbe } from '../src/probeModel.js';
import { getLevel, makeGpioLedLevel } from '../src/levels/catalog.js';

const level = getLevel(1);
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 0.001, `${actual} ≈ ${expected}`);

test('the course level opens with fixed reference points and three unselected resistors', () => {
  const game = startGame();
  assert.deepEqual(level.board.fixedParts, ['power', 'nodeA', 'ground']);
  assert.ok(level.board.fixedParts.every(id => game.placed[id]));
  assert.ok(level.circuit.resistors.every(id => !game.placed[id]));
  assert.deepEqual(game.wires, []);
  assert.deepEqual(game.resistorValues, { r1: null, r2: null, r3: null });
  assert.deepEqual(evaluateCircuit(game).checks, [false, false, false, false]);
});

test('series and parallel DC solver satisfies KCL, KVL and per-part power', () => {
  const game = startGame(true);
  const report = evaluateCircuit(game);
  assert.equal(report.kind, 'success');
  assert.equal(report.success, true);
  near(report.network.nodeAV, 4.5);
  near(report.network.totalCurrentMa, 4.5);
  near(report.network.r2CurrentMa, 2.25);
  near(report.network.r3CurrentMa, 2.25);
  near(report.network.resistorResults.r1.powerW, 0.02025);
  near(report.network.resistorResults.r2.powerW, 0.010125);
  assert.equal(report.componentStates.r1.state, 'conducting');
  assert.equal(report.network.wireCurrents['nodeA-r1.b'].currentMa, 4.5);
  assert.equal(report.network.wireCurrents['nodeA-r2.a'].currentMa, 2.25);
  assert.equal(report.network.wireCurrents['nodeA-r3.a'].currentMa, 2.25);
  assert.equal(report.flowEdges.length, 6);
});

test('a reversed resistor orientation is electrically equivalent', () => {
  const game = startGame(true);
  game.wires = game.wires.filter(wire => !['nodeA-r2.a', 'r2.b-ground'].includes(wire));
  game.wires.push('nodeA-r2.b', 'r2.a-ground');
  const report = evaluateCircuit(game);
  assert.equal(report.success, true);
  assert.equal(report.network.resistorResults.r2.direction, 'reverse');
});

test('open branch changes the node voltage but cannot clear the level', () => {
  const game = startGame(true);
  game.wires = game.wires.filter(wire => wire !== 'r3.b-ground');
  const report = evaluateCircuit(game);
  assert.equal(report.kind, 'open-circuit');
  assert.equal(report.success, false);
  near(report.network.nodeAV, 6);
  near(report.network.totalCurrentMa, 3);
  near(report.network.r2CurrentMa, 3);
  near(report.network.r3CurrentMa, 0);
  assert.equal(report.componentStates.r3.state, 'normal');
});

test('a source short is not given a fabricated current or voltage', () => {
  const game = startGame(true);
  game.wires.push('power-ground');
  const report = evaluateCircuit(game);
  assert.equal(report.kind, 'supply-short');
  assert.equal(report.success, false);
  assert.equal(report.network.totalCurrentMa, null);
  assert.equal(readProbe(game, report, { target: 'r1.b' }, level).voltageV, null);
});

test('wrong component values remain live but fail the numerical goals', () => {
  const game = startGame(true);
  game.resistorValues.r1 = 1500;
  const report = evaluateCircuit(game);
  assert.equal(report.kind, 'target-mismatch');
  assert.equal(report.checks[0], true);
  assert.equal(report.checks[1], false);
  assert.equal(report.success, false);
  near(report.network.nodeAV, 3.6);
});

test('a correct circuit clears without typed calculations', () => {
  const game = startGame(true);
  const report = evaluateCircuit(game);
  assert.equal('answers' in game, false);
  assert.equal(report.kind, 'success');
  assert.deepEqual(report.checks, [true, true, true, true]);
  assert.equal(report.success, true);
});

test('the earlier LED circuit remains a reusable model outside the course catalog', () => {
  const legacy = makeGpioLedLevel({ id: 982, title: 'LED', chapter: '测试', chapterSubtitle: '测试',
    story: '测试', voltageV: 3.3, ledForwardV: 2, resistorOptionsOhms: [100, 330], warningCurrentMa: 20 });
  const game = { ...startGame(true, legacy), resistorOhms: 330 };
  assert.equal(evaluateCircuit(game, legacy).kind, 'success');
  assert.equal(evaluateCircuit(game, legacy).componentStates.led.state, 'lit');
});
