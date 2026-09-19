import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCircuit, startGame } from '../src/evaluateCircuit.js';
import { makeGpioLedLevel, getLevel, getNextLevel, levelIds } from '../src/levels/catalog.js';
import { componentParameters } from '../src/componentParameters.js';

test('the active first level is a circuit-analysis task with no MCU or LED', () => {
  assert.deepEqual(levelIds, [1, 2]);
  assert.equal(getLevel(null).id, 1);
  assert.equal(getLevel(1).title, '分流节点');
  assert.equal(getLevel(5).id, 1);
  assert.equal(getNextLevel(1).id, 2);
  assert.equal(getNextLevel(2), null);
  assert.equal(getLevel(1).model, 'resistor-dc-v1');
  assert.deepEqual(getLevel(1).circuit.resistors, ['r1', 'r2', 'r3']);
  assert.equal(getLevel(1).circuit.nodeA, 'nodeA');
  assert.ok(getLevel(1).parts.every(part => !['mcu', 'led'].includes(part.id)));
});

test('level 2 is a dual-fault diagnosis task on a four-resistor series chain', () => {
  const level = getLevel(2);
  assert.equal(level.model, 'resistor-dc-v1');
  assert.equal(level.title, '故障定位');
  assert.deepEqual(level.board.fixedParts, ['power', 'nodeA', 'ground', 'r1', 'r2', 'r3', 'r4']);
  assert.equal(level.circuit.solutionWires.length, 6);
  assert.equal(level.circuit.hiddenOpenCandidates.length, 6);
  assert.deepEqual(level.circuit.hiddenShortCandidates, ['r1', 'r2', 'r3', 'r4']);
  assert.deepEqual(level.circuit.resistors, ['r1', 'r2', 'r3', 'r4']);
  assert.deepEqual(level.electrical.defaultOhms, level.electrical.referenceOhms);
  assert.equal(level.goals.length, 1);
  assert.equal(level.goals[0].id, 'diagnose');
  assert.equal(level.knowledge.length, 2);
  const game = startGame(false, level);
  assert.ok(['power', 'nodeA', 'ground', 'r1', 'r2', 'r3', 'r4'].every(id => game.placed[id]));
  assert.equal(game.visualWires.length, 6);
  assert.ok(['open', 'short'].includes(game.faultKind));
  assert.deepEqual(game.suspectedWires, []);
  assert.equal(game.suspectedShort, null);
  if (game.faultKind === 'open') {
    assert.equal(game.wires.length, 5);
    assert.ok(!game.wires.includes(game.hiddenOpenWire));
    assert.ok(game.visualWires.includes(game.hiddenOpenWire));
  } else {
    assert.equal(game.wires.length, 7);
    assert.ok(game.wires.includes(game.hiddenShortWire));
    assert.ok(!game.visualWires.includes(game.hiddenShortWire));
  }
});

test('each resistor has an independent parameter menu and current state', () => {
  const level = getLevel(1);
  const game = startGame(false, level);
  assert.equal(componentParameters('r1', level, game).value, '1000 Ω');
  game.resistorValues.r1 = 1500;
  assert.equal(componentParameters('r1', level, game).value, '1500 Ω');
  assert.equal(componentParameters('r2', level, game).value, '1000 Ω');
  assert.equal(componentParameters('power', level, game).value, '9.0 V（固定）');
  assert.equal(evaluateCircuit(game, level).success, false);
});

test('legacy LED template remains separately valid and rejects impossible values', () => {
  const input = { title: '参数测试', chapter: '测试', chapterSubtitle: '测试', story: '测试', voltageV: 5, ledForwardV: 2 };
  const level = makeGpioLedLevel({ ...input, id: 934, resistorOhms: 1000, warningCurrentMa: 4 });
  const game = startGame(true, level);
  assert.equal(evaluateCircuit(game, level).success, true);
  assert.throws(() => makeGpioLedLevel({ ...input, id: 935, resistorOhms: 0, warningCurrentMa: 20 }), /Invalid level/);
  assert.throws(() => makeGpioLedLevel({ ...input, id: 936, resistorOptionsOhms: [47], warningCurrentMa: 20 }), /no resistor choice/);
  assert.throws(() => evaluateCircuit(startGame(false, level), getLevel(1)), /different level/);
});
