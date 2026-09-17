import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCircuit, startGame } from '../src/evaluateCircuit.js';
import { makeGpioLedLevel, getLevel, getNextLevel, levelIds } from '../src/levels/catalog.js';
import { componentParameters } from '../src/componentParameters.js';

test('the active first level is a circuit-analysis task with no MCU or LED', () => {
  assert.deepEqual(levelIds, [1]);
  assert.equal(getLevel(null).id, 1);
  assert.equal(getLevel(1).title, '分流节点');
  assert.equal(getLevel(5).id, 1);
  assert.equal(getNextLevel(1), null);
  assert.equal(getLevel(1).model, 'resistor-dc-v1');
  assert.deepEqual(getLevel(1).circuit.resistors, ['r1', 'r2', 'r3']);
  assert.equal(getLevel(1).circuit.nodeA, 'nodeA');
  assert.ok(getLevel(1).parts.every(part => !['mcu', 'led'].includes(part.id)));
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
