import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCircuit, startGame } from '../src/evaluateCircuit.js';
import { makeGpioLedLevel, getLevel, getNextLevel, levelIds } from '../src/levels/catalog.js';
import { hasReferenceAnswer, referenceAnswer } from '../src/levelAnswer.js';
import { autoInspectKinds, shouldAutoInspect } from '../src/faultPolicy.js';

test('课程从题1-1 开始：只有一关，纯直流电阻分析，无 MCU / LED', () => {
  assert.deepEqual(levelIds, [1, 2, 3]);
  assert.equal(getLevel(null).id, 1);
  assert.equal(getLevel(1).title, '题1-1 · 参考方向与功率');
  assert.equal(getLevel(99).id, 1);
  assert.equal(getNextLevel(1).id, 2);
  assert.equal(getLevel(1).model, 'resistor-dc-v1');
  assert.deepEqual(getLevel(1).circuit.resistors, ['r1']);
  assert.equal(getLevel(1).circuit.nodeA, 'r1.a');
  assert.deepEqual(getLevel(1).board.fixedParts, ['power', 'r1', 'ground']);
  assert.deepEqual(getLevel(1).goals.map(goal => goal.id), ['convention']);
  // 题1-1(1)(2): 参考方向是否关联、ui 表示什么功率。
  assert.deepEqual(getLevel(1).goals[0].when.all.map(c => c.assocJudged || c.uiMeaningJudged || c.powerJudged), [
    { id: 'r1', expect: 'in' }, { id: 'r1', expect: 'absorb' }, { id: 'r1', expect: 'absorb' },
  ]);
  assert.ok(getLevel(1).parts.every(part => !['mcu', 'led'].includes(part.id)));
});

test('题1-1 电路已预接好：电源→R1→GND，R1=1 kΩ', () => {
  const level = getLevel(1);
  const game = startGame(false, level);
  assert.ok(['power', 'r1', 'ground'].every(id => game.placed[id]));
  assert.deepEqual(game.wires, ['power-r1.a', 'r1.b-ground']);
  assert.deepEqual(game.powerJudging, {});
  assert.deepEqual(level.electrical.referenceOhms, { r1: 1000 });
  assert.deepEqual(level.electrical.defaultOhms, { r1: 1000 });
  // 参考解里 R1=1 kΩ、电源发出、R1 吸收。
  const solved = startGame(true, level);
  assert.deepEqual(solved.wires, level.circuit.solutionWires);
  assert.deepEqual(solved.powerJudging, { r1: 'absorb' });
  assert.deepEqual(solved.assocJudging, { r1: 'in' });
  assert.deepEqual(solved.uiMeaningJudging, { r1: 'absorb' });
  assert.equal(evaluateCircuit(solved, level).success, true);
});

test('参考解从关卡数据计算，不写死', () => {
  const answer = referenceAnswer(getLevel(1));
  assert.deepEqual(answer.values.map(v => v.text), ['R1 = 1 kΩ']);
  assert.equal(answer.wires.length, 2);
  assert.match(answer.wires[0], /电源 → R1 · 左端/);
  assert.match(answer.wires[1], /R1 · 右端 → GND/);
  assert.deepEqual(answer.powers.map(p => p.text), [
    'R1 吸收 144.00 mW', '电源 释放 144.00 mW',
  ]);
  assert.deepEqual(answer.judgements.map(j => j.text), ['R1：吸收功率']);
  assert.equal(hasReferenceAnswer(getLevel(1)), true);
});

test('过流等故障才自动弹窗；判分按钮归玩家', () => {
  assert.equal(shouldAutoInspect('resistor-overload'), false);
  assert.deepEqual([...autoInspectKinds], ['overcurrent', 'gpio-short', 'supply-short', 'current-source-short']);
  for (const kind of ['supply-short', 'current-source-short']) assert.equal(shouldAutoInspect(kind), true, kind);
  assert.equal(shouldAutoInspect('target-mismatch'), false);
});

test('legacy LED 模板单独有效，且拒绝不合理取值', () => {
  const input = { title: '参数测试', chapter: '测试', chapterSubtitle: '测试', story: '测试', voltageV: 5, ledForwardV: 2 };
  const level = makeGpioLedLevel({ ...input, id: 934, resistorOhms: 1000, warningCurrentMa: 4 });
  const game = startGame(true, level);
  assert.equal(evaluateCircuit(game, level).success, true);
  assert.throws(() => makeGpioLedLevel({ ...input, id: 935, resistorOhms: 0, warningCurrentMa: 20 }), /Invalid level/);
  assert.throws(() => makeGpioLedLevel({ ...input, id: 936, resistorOptionsOhms: [47], warningCurrentMa: 20 }), /no resistor choice/);
});
