import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCircuit, startGame } from '../src/evaluateCircuit.js';
import { getLevel, makeGpioLedLevel } from '../src/levels/catalog.js';

const level = getLevel(1);
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 0.01, `${actual} ≈ ${expected}`);

test('题1-1 关卡已预接好：电源、R1、GND 全部就位', () => {
  const game = startGame(false, level);
  assert.deepEqual(level.board.fixedParts, ['power', 'r1', 'ground']);
  assert.ok(['power', 'r1', 'ground'].every(id => game.placed[id]));
  // 题1-1 给的是图，电路一开始就连好，玩家不搭建。
  assert.deepEqual(game.wires, ['power-r1.a', 'r1.b-ground']);
  assert.deepEqual(game.powerJudging, {});
  assert.deepEqual(evaluateCircuit(game, level).checks, [false]);
});

test('参考解：节点 A=12 V、R1=12 mA、电源发出 144 mW、R1 吸收 144 mW', () => {
  const report = evaluateCircuit(startGame(true, level), level);
  assert.equal(report.kind, 'success');
  near(report.network.nodeAV, 12);
  near(report.network.r1CurrentMa, 12);
  near(report.network.elementPowerMw.power, -144);
  near(report.network.elementPowerMw.r1, 144);
  near(Object.values(report.network.elementPowerMw).reduce((s, v) => s + v, 0), 0);
});

test('参考方向与功率判断必须和电路一致：判对才通关，判错仍失败', () => {
  // 还没判：预接电路但判断为空，目标不勾。
  const unjudged = evaluateCircuit(startGame(false, level), level);
  assert.deepEqual(unjudged.checks, [false]);
  assert.equal(unjudged.success, false);
  // 全部判对：convention（关联/ui 乘积含义）。
  const right = evaluateCircuit(startGame(true, level), level);
  assert.deepEqual(right.checks, [true]);
  assert.equal(right.success, true);
  // 判错：把 R1 说成"电流从 + 端流出（非关联）"→ 不勾，且给出判断题专用提示。
  const wrongConvention = evaluateCircuit({ ...startGame(true, level), assocJudging: { r1: 'out', power: 'out' } }, level);
  assert.equal(wrongConvention.checks[0], false);
  assert.match(wrongConvention.headline, /参考方向/);
});

test('电源被导线直连到 GND 是短路，不给出伪造读数', () => {
  const game = startGame(true, level);
  game.wires.push('power-ground');
  const report = evaluateCircuit(game, level);
  assert.equal(report.kind, 'supply-short');
  assert.equal(report.success, false);
  assert.equal(report.network.totalCurrentMa, null);
});

test('断开 R1 到 GND 的线，支路没有电流', () => {
  const game = startGame(true, level);
  game.wires = game.wires.filter(wire => wire !== 'r1.b-ground');
  const report = evaluateCircuit(game, level);
  assert.equal(report.success, false);
  near(report.network.r1CurrentMa, 0);
});

test('探针是测量工具，不参与判分', () => {
  const solved = startGame(true, level);
  solved.powerJudging = { r1: 'absorb' };
  assert.equal(evaluateCircuit(solved, level).success, true);
  assert.equal(evaluateCircuit(solved, level, { target: 'nodeA' }).success, true);
  assert.equal(evaluateCircuit(solved, level, { target: 'r1.b' }).success, true);
});

test('legacy LED 模板仍是独立可用的模型', () => {
  const legacy = makeGpioLedLevel({ id: 982, title: 'LED', chapter: '测试', chapterSubtitle: '测试',
    story: '测试', voltageV: 3.3, ledForwardV: 2, resistorOptionsOhms: [100, 330], warningCurrentMa: 20 });
  const game = { ...startGame(true, legacy), resistorOhms: 330 };
  assert.equal(evaluateCircuit(game, legacy).kind, 'success');
  assert.equal(evaluateCircuit(game, legacy).componentStates.led.state, 'lit');
});
