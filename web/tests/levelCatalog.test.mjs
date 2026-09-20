import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCircuit, startGame } from '../src/evaluateCircuit.js';
import { makeGpioLedLevel, getLevel, getNextLevel, levelIds } from '../src/levels/catalog.js';
import { componentParameters, componentStatusText, powerReferenceText } from '../src/componentParameters.js';
import { hasReferenceAnswer, referenceAnswer } from '../src/levelAnswer.js';
import { autoInspectKinds, shouldAutoInspect } from '../src/faultPolicy.js';

test('the active first level is a circuit-analysis task with no MCU or LED', () => {
  assert.deepEqual(levelIds, [1, 2, 3]);
  assert.equal(getLevel(null).id, 1);
  assert.equal(getLevel(1).title, '参考方向与功率');
  assert.equal(getLevel(5).id, 1);
  assert.equal(getNextLevel(1).id, 2);
  assert.equal(getNextLevel(2).id, 3);
  assert.equal(getNextLevel(3), null);
  assert.equal(getLevel(1).model, 'resistor-dc-v1');
  assert.deepEqual(getLevel(1).circuit.resistors, ['r1', 'r2']);
  assert.equal(getLevel(1).circuit.nodeA, 'nodeA');
  assert.deepEqual(getLevel(1).board.fixedParts, ['power', 'isource', 'nodeA', 'ground']);
  assert.deepEqual(getLevel(1).goals.map(goal => goal.id), ['node', 'power']);
  // One reading goal plus one judgement goal: the player must also state, per
  // element, whether it absorbs or delivers power.
  assert.deepEqual(getLevel(1).goals[0].when.all[0].metricBetween, { key: 'nodeAV', min: 2.95, max: 3.05 });
  assert.deepEqual(getLevel(1).goals[1].when.all.map(condition => condition.powerJudged),
    [{ id: 'power', expect: 'deliver' }, { id: 'r1', expect: 'absorb' }, { id: 'r2', expect: 'absorb' }, { id: 'isource', expect: 'absorb' }]);
  assert.ok(getLevel(1).parts.every(part => !['mcu', 'led'].includes(part.id)));
});

test('level 2 is a two-node controlled-source task with a tunable transconductance', () => {
  const level = getLevel(2);
  assert.equal(level.model, 'resistor-dc-v1');
  assert.equal(level.title, '源与受控源');
  assert.deepEqual(level.board.fixedParts, ['power', 'vccs', 'nodeA', 'nodeB', 'ground']);
  assert.deepEqual(level.circuit.resistors, ['r1', 'r2', 'r3']);
  assert.equal(level.circuit.currentSource, undefined);
  assert.equal(level.circuit.nodeB, 'nodeB');
  assert.deepEqual(level.circuit.controlledSource,
    { id: 'vccs', out: 'vccs.out', in: 'vccs.in', control: { positive: 'nodeB', negative: 'ground' } });
  assert.equal(level.electrical.sourceV, 9);
  // The level hands the player a knob: reference 0.5 mS, default 0.25 mS.
  assert.equal(level.electrical.controlledTransconductanceMs, 0.5);
  assert.equal(level.electrical.defaultTransconductanceMs, 0.25);
  assert.deepEqual(level.electrical.gainRangeMs, [0.05, 1, 0.05]);
  assert.deepEqual(level.electrical.referenceOhms, { r1: 1000, r2: 1000, r3: 1000 });
  assert.deepEqual(level.electrical.defaultOhms, { r1: 1500, r2: 1000, r3: 1500 });
  assert.equal(level.circuit.solutionWires.length, 8);
  assert.deepEqual(level.goals.map(goal => goal.id), ['node', 'controlled']);
  assert.deepEqual(level.goals[0].when.all[0].metricBetween, { key: 'nodeBV', min: 3.55, max: 3.65 });
  assert.deepEqual(level.goals[1].when.all[0].metricBetween, { key: 'controlledSourceCurrentMa', min: 1.75, max: 1.85 });
  assert.equal(level.knowledge.length, 3);
  assert.match(level.knowledge[0].title, /受控源/);
  assert.ok(level.parts.some(part => part.id === 'vccs'));
  assert.ok(level.parts.some(part => part.id === 'nodeB'));
  const game = startGame(false, level);
  assert.ok(['power', 'vccs', 'nodeA', 'nodeB', 'ground'].every(id => game.placed[id]));
  assert.ok(!game.placed.r1 && !game.placed.r2 && !game.placed.r3);
  assert.equal(game.controlledGmMs, 0.25);
  assert.equal(startGame(true, level).controlledGmMs, 0.5);
  assert.deepEqual(game.wires, []);
});

test('level 3 is a power-budget build level with choosable part ratings', () => {
  const level = getLevel(3);
  assert.equal(level.model, 'resistor-dc-v1');
  assert.equal(level.title, '功率预算与供电设计');
  assert.deepEqual(level.board.fixedParts, ['power', 'nodeA', 'ground', 'r2']);
  assert.equal(level.circuit.load, 'r2');
  assert.equal(level.circuit.currentSource, undefined);
  assert.equal(level.circuit.controlledSource, undefined);
  assert.equal(level.circuit.candidates, undefined, 'the multiple-choice version was dropped');
  // The parts library is back: the player builds the series element by hand.
  assert.ok(level.parts.some(part => part.id === 'resistor'));
  assert.equal(level.electrical.loadOhms, 100);
  assert.equal(level.electrical.resistorRatedPowerW, 0.25);
  assert.deepEqual(level.electrical.resistorRatingOptionsW, [0.25, 0.5]);
  assert.deepEqual(level.electrical.referenceOhms, { r1: 600, r2: 100, r3: 600 });
  // The dropped-resistor default must not be the answer: 300 Ω is the equivalent
  // resistance the whole level is about.
  assert.notEqual(level.electrical.defaultOhms.r1, 300);
  assert.ok(level.electrical.resistorOptionsOhms.includes(level.electrical.defaultOhms.r1));
  assert.deepEqual(level.goals.map(goal => goal.id), ['node', 'load']);
  assert.deepEqual(level.goals[0].when.all[0].metricBetween, { key: 'nodeAV', min: 2.95, max: 3.05 });
  assert.deepEqual(level.goals[1].when.all[0].metricBetween, { key: 'r2PowerMw', min: 87, max: 93 });
  assert.equal(level.knowledge.length, 3);
  // Only the supply, the node, the ground and the fixed load start on the board.
  const game = startGame(false, level);
  assert.ok(['power', 'nodeA', 'ground', 'r2'].every(id => game.placed[id]));
  assert.ok(!game.placed.r1 && !game.placed.r3);
  assert.deepEqual(game.wires, []);
  assert.equal(game.resistorValues.r2, 100);
});

test('the power judgement shows the two reference readings and their convention', () => {
  const level = getLevel(1);
  const report = evaluateCircuit(startGame(true, level), level);
  const resistorText = powerReferenceText('r1', level, report.componentStates.r1);
  assert.match(resistorText, /U\(a→b\)、I\(a→b\)/);
  assert.match(resistorText, /\+9\.00 V/);
  assert.match(resistorText, /\+9\.00 mA/);
  assert.match(resistorText, /关联参考方向：P = U·I/);
  const sourceText = powerReferenceText('isource', level, report.componentStates.isource);
  // Sources are drawn with the arrow leaving the marked + terminal: non-associated.
  assert.match(sourceText, /非关联参考方向：P = −U·I/);
  assert.match(sourceText, /-3\.00 V/);
  assert.match(sourceText, /\+6\.00 mA/);
  // Without solved readings there is nothing to judge against.
  assert.equal(powerReferenceText('r1', level, { state: 'normal' }), null);
});

test('the reference answer is computed from the level data, never hardcoded', () => {
  const answer = referenceAnswer(getLevel(1));
  assert.deepEqual(answer.values.map(value => value.text), ['R1 = 1 kΩ', 'R2 = 1 kΩ']);
  assert.equal(answer.wires.length, 6);
  assert.match(answer.wires[0], /电源 → R1 · 左端/);
  assert.match(answer.wires[4], /电流源 · 流回端 → 节点 A/);
  assert.deepEqual(answer.readings.map(reading => reading.text), ['3.00 V', '9.00 mA', '-3.00 V']);
  assert.deepEqual(answer.powers.map(power => power.text), [
    'R1 吸收 81.00 mW', 'R2 吸收 9.00 mW', '电源 释放 108.00 mW', '电流源 吸收 18.00 mW',
  ]);
  assert.deepEqual(answer.judgements.map(item => item.text),
    ['电源：释放功率', 'R1：吸收功率', 'R2：吸收功率', '电流源：吸收功率']);
  // A tunable value is part of the answer: resistor values alone are not enough
  // when the level hands the player a knob.
  assert.deepEqual(referenceAnswer(getLevel(2)).values.map(value => value.text),
    ['R1 = 1 kΩ', 'R2 = 1 kΩ', 'R3 = 1 kΩ', '跨导 g = 0.50 mS']);
  assert.equal(referenceAnswer(getLevel(2), { controlledGmMs: 0.25 }).values.at(-1).text,
    '跨导 g = 0.50 mS（当前 0.25 mS）');
  assert.deepEqual(referenceAnswer(getLevel(2)).judgements, []);
  const wires = referenceAnswer(getLevel(2)).wires;
  assert.ok(wires.some(wire => /R2 · 右端 → 节点 B/.test(wire)), wires.join(' | '));
  assert.ok(wires.some(wire => /受控源 · 流出端 → 节点 A/.test(wire)), wires.join(' | '));
  // When a level lets the player choose a part's rated power, the answer lists it
  // for the parts that carry current (the fixed load keeps its given value).
  assert.deepEqual(referenceAnswer(getLevel(3)).values.map(value => value.text),
    ['R1 = 600 Ω · 250 mW（可选 250 / 500 mW）', 'R2 = 100 Ω', 'R3 = 600 Ω · 250 mW（可选 250 / 500 mW）']);
  for (const id of levelIds) assert.equal(hasReferenceAnswer(getLevel(id)), true, 'level ' + id);
});

test('a part’s rated power is a player choice on level 3, and fixed on level 1', () => {
  const level = getLevel(3);
  const game = startGame(false, level);
  const info = componentParameters('r1', level, game);
  assert.deepEqual(info.ratings.options, [0.25, 0.5]);
  assert.equal(info.ratings.value, 0.25, 'defaults to the level rating');
  assert.match(info.value, /250 mW/);
  assert.deepEqual(componentParameters('r1', level, { ...game, resistorRatings: { r1: 0.5 } }).ratings.value, 0.5);
  // The fixed load keeps its given value and rating: nothing to choose.
  const load = componentParameters('r2', level, game);
  assert.ok(!load.options, 'the fixed load offers no value choices');
  assert.ok(!load.ratings, 'the fixed load offers no rating choices');
  // The overload status names the part's own rating, not a level constant.
  assert.match(componentStatusText('r1', { state: 'overload', powerW: 0.27, ratedPowerW: 0.25 }), /270 mW \/ 额定 250 mW/);
  // A level without rating choices (level 1) shows no rating row.
  const first = getLevel(1);
  assert.ok(!componentParameters('r1', first, startGame(false, first)).ratings);
});

test('a part over its rated power never opens the result dialog by itself', () => {
  // The verdict belongs to the 检查电路 button: an overloaded part is a stress state
  // the player meets while building (level 3 is built around exactly that), so the
  // dialog must not appear on its own. Shorts and overcurrent still do.
  assert.equal(shouldAutoInspect('resistor-overload'), false);
  assert.deepEqual([...autoInspectKinds], ['overcurrent', 'gpio-short', 'supply-short', 'current-source-short']);
  for (const kind of ['supply-short', 'current-source-short']) assert.equal(shouldAutoInspect(kind), true, kind);
  assert.equal(shouldAutoInspect('target-mismatch'), false);
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
