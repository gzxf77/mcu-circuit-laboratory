import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCircuit, startGame } from '../src/evaluateCircuit.js';
import { makeGpioLedLevel, getLevel, getNextLevel, levelIds } from '../src/levels/catalog.js';
import { readProbe } from '../src/probeModel.js';
import { componentParameters } from '../src/componentParameters.js';

test('one exploratory first level replaces the former five repeated levels', () => {
  assert.deepEqual(levelIds, [1]);
  assert.equal(getLevel(null).id, 1);
  assert.equal(getLevel(1).title, '点亮信号灯');
  assert.equal(getLevel(5).id, 1);
  assert.equal(getNextLevel(1), null);
  assert.equal(getLevel(1).experiments.length, 3);
});

test('level one opens empty and requires a player-selected resistor', () => {
  const level = getLevel(1);
  const game = startGame(false, level);
  assert.equal(game.wires.length, 0);
  assert.ok(Object.values(game.placed).every(value => value === false));
  assert.equal(game.resistorOhms, null);
  assert.deepEqual(evaluateCircuit(game, level).checks, [false, false, false, false]);
  assert.equal(evaluateCircuit(startGame(true, level), level).kind, 'resistor-unselected');
});

test('changing resistor values recomputes current and the 20 mA comparison', () => {
  const level = getLevel(1);
  const placedAndWired = startGame(true, level);
  for (const [ohms, expectedKind, expectedCurrent] of [
    [47, 'current-out-of-range', '约 27.7 mA'],
    [100, 'success', '约 13.0 mA'],
    [330, 'success', '约 3.9 mA'],
    [1000, 'success', '约 1.3 mA'],
  ]) {
    const game = { ...placedAndWired, resistorOhms: ohms };
    const report = evaluateCircuit(game, level);
    assert.equal(report.kind, expectedKind, `${ohms} Ω`);
    assert.equal(report.currentLabel, expectedCurrent, `${ohms} Ω`);
    assert.equal(report.ledState, 'on');
    assert.equal(readProbe(game, report, { target: 'resistor.b' }, level).currentLabel, expectedCurrent);
  }
  assert.match(level.concept, /I = U ÷ R/);
  assert.doesNotMatch(level.concept, /330|470|3\.9|2\.8/);
});

test('component menus use live level values and LED orientation', () => {
  const level = getLevel(1);
  const game = startGame(false, level);
  assert.equal(componentParameters('resistor', level, game).value, '尚未选择阻值');
  assert.deepEqual(componentParameters('resistor', level, game).options, [47, 100, 220, 330, 470, 680, 1000]);
  assert.equal(componentParameters('mcu', level, game).value, 'GPIO0 高电平约 3.3 V');
  assert.match(componentParameters('led', level, { ...game, reversed: true }).detail, /阳极在右侧/);
});

test('the reusable template still accepts fixed parameters and rejects impossible levels', () => {
  const input = { title: '参数测试', chapter: '测试', chapterSubtitle: '测试', story: '测试', voltageV: 5, ledForwardV: 2 };
  const level = makeGpioLedLevel({ ...input, id: 934, resistorOhms: 1000, warningCurrentMa: 4 });
  const game = startGame(true, level);
  const report = evaluateCircuit(game, level);
  assert.equal(report.currentLabel, '约 3.0 mA');
  assert.equal(report.success, true);
  assert.equal(readProbe(game, report, { target: 'power' }, level).voltageV, 5);
  assert.equal(readProbe(game, report, { target: 'led.a' }, level).voltageV, 2);
  assert.throws(() => makeGpioLedLevel({ ...input, id: 935, resistorOhms: 0, warningCurrentMa: 20 }), /Invalid level/);
  assert.throws(() => makeGpioLedLevel({ ...input, id: 936, resistorOptionsOhms: [47], warningCurrentMa: 20 }), /no resistor choice/);
  assert.throws(() => evaluateCircuit(startGame(false, level), getLevel(1)), /different level/);
});
