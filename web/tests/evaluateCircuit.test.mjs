import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCircuit, startGame } from '../src/evaluateCircuit.js';
import { readProbe } from '../src/probeModel.js';
import { getLevel, makeGpioLedLevel } from '../src/levels/catalog.js';
import { referenceAnswer } from '../src/levelAnswer.js';

const level = getLevel(1);
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 0.001, `${actual} ≈ ${expected}`);

test('the course level opens with fixed reference points and placeable resistors', () => {
  const game = startGame();
  assert.deepEqual(level.board.fixedParts, ['power', 'isource', 'nodeA', 'ground']);
  assert.ok(level.board.fixedParts.every(id => game.placed[id]));
  assert.ok(level.circuit.resistors.every(id => !game.placed[id]));
  assert.deepEqual(game.wires, []);
  // The defaults deliberately do not solve the level: 1.5 kΩ on both sides puts
  // node A at 1.5 V, so the values must change as well as the wiring.
  assert.deepEqual(game.resistorValues, { r1: 1500, r2: 1500 });
  assert.deepEqual(game.powerJudging, {});
  assert.deepEqual(evaluateCircuit(game).checks, [false, false]);
});

test('the two-source node satisfies KCL, power conservation and per-part power', () => {
  const game = startGame(true);
  const report = evaluateCircuit(game, level);
  assert.equal(report.kind, 'success');
  assert.equal(report.success, true);
  near(report.network.nodeAV, 3);
  near(report.network.r1CurrentMa, 9);
  near(report.network.r2CurrentMa, 3);
  near(report.network.resistorResults.r1.powerW, 0.081);
  near(report.network.resistorResults.r2.powerW, 0.009);
  // Signed power, absorbed positive: the 12 V source delivers 108 mW while the
  // 6 mA current source is charged (absorbs 18 mW). 81 + 9 + 18 = 108.
  const powers = report.network.elementPowerMw;
  near(powers.power, -108);
  near(powers.r1, 81);
  near(powers.r2, 9);
  near(powers.isource, 18);
  near(Object.values(powers).reduce((sum, value) => sum + value, 0), 0);
  assert.equal(report.componentStates.isource.absorbedPowerMw > 0, true);
  assert.equal(report.componentStates.r1.state, 'conducting');
  assert.equal(report.network.wireCurrents['nodeA-r1.b'].currentMa, 9);
  assert.equal(report.network.wireCurrents['isource.in-nodeA'].currentMa, 6);
});

test('a reversed resistor orientation is electrically equivalent', () => {
  const game = startGame(true);
  game.wires = game.wires.filter(wire => !['power-r1.a', 'r1.b-nodeA'].includes(wire));
  game.wires.push('power-r1.b', 'r1.a-nodeA');
  const report = evaluateCircuit(game, level);
  assert.equal(report.success, true);
  assert.equal(report.network.resistorResults.r1.direction, 'reverse');
  near(report.network.nodeAV, 3);
});

test('the current source direction decides which side of the node is charged', () => {
  // Wired the other way round it injects instead of drawing current, so node A
  // rises to 9 V and the source becomes the one delivering power.
  const game = startGame(true);
  game.wires = game.wires.filter(wire => !['isource.in-nodeA', 'isource.out-ground'].includes(wire));
  game.wires.push('isource.out-nodeA', 'isource.in-ground');
  const report = evaluateCircuit(game, level);
  assert.equal(report.success, false);
  assert.deepEqual(report.checks, [false, false]);
  near(report.network.nodeAV, 9);
  near(report.network.elementPowerMw.isource, -54);
});

test('an open branch changes the reading and cannot clear the level', () => {
  // Cut the supply: node A is then driven only by the current source sinking into
  // R2, so it goes negative and the 6 mA source becomes the one delivering power.
  const game = startGame(true);
  game.wires = game.wires.filter(wire => wire !== 'power-r1.a');
  const report = evaluateCircuit(game, level);
  assert.equal(report.success, false);
  assert.deepEqual(report.checks, [false, false]);
  near(report.network.nodeAV, -6);
  near(report.network.r1CurrentMa, 0);
  near(report.network.r2CurrentMa, 6);
  near(report.network.elementPowerMw.isource, -36);
  // The other open branch: with R2 gone the current source has no return path at
  // all, so it conducts nothing instead of forcing 6 mA through an open circuit.
  const open = startGame(true);
  open.wires = open.wires.filter(wire => wire !== 'r2.b-ground');
  const openReport = evaluateCircuit(open, level);
  assert.equal(openReport.kind, 'open-circuit');
  assert.equal(openReport.success, false);
  near(openReport.network.nodeAV, 12);
  near(openReport.network.r1CurrentMa, 0);
});

test('a source short is not given a fabricated current or voltage', () => {
  const game = startGame(true);
  game.wires.push('power-ground');
  const report = evaluateCircuit(game, level);
  assert.equal(report.kind, 'supply-short');
  assert.equal(report.success, false);
  assert.equal(report.network.totalCurrentMa, null);
  assert.equal(readProbe(game, report, { target: 'r1.b' }, level).voltageV, null);
});

test('wrong component values remain live but fail the numerical goals', () => {
  const game = startGame(true);
  game.resistorValues.r2 = 2000;
  const report = evaluateCircuit(game, level);
  assert.equal(report.success, false);
  assert.equal(report.checks[0], false);
  near(report.network.nodeAV, 4);
});

test('default resistor values do not solve the level, the reference values do', () => {
  const game = startGame(true);
  game.resistorValues = { ...level.electrical.defaultOhms };
  assert.equal(evaluateCircuit(game, level).success, false);
  near(evaluateCircuit(game, level).network.nodeAV, 1.5);
  game.resistorValues = { ...level.electrical.referenceOhms };
  assert.equal(evaluateCircuit(game, level).success, true);
});

test('a correct circuit clears without typed calculations', () => {
  const game = startGame(true);
  const report = evaluateCircuit(game, level);
  assert.equal('answers' in game, false);
  assert.equal(report.kind, 'success');
  assert.deepEqual(report.checks, [true, true]);
  assert.equal(report.success, true);
});

test('a power judgement only counts when the built circuit really has that sign', () => {
  const game = startGame(true);
  // Right answer, wrong circuit: the current source still injects, so it is
  // delivering power and the judgement cannot pass.
  game.wires = ['power-r1.a', 'r1.b-nodeA', 'nodeA-r2.a', 'r2.b-ground', 'isource.out-nodeA', 'isource.in-ground'];
  assert.equal(evaluateCircuit(game, level).checks[1], false);
  // Right circuit, wrong answer for the current source.
  game.wires = [...level.circuit.solutionWires];
  game.powerJudging = { ...game.powerJudging, isource: 'deliver' };
  assert.equal(evaluateCircuit(game, level).checks[1], false);
  game.powerJudging = { ...game.powerJudging, isource: 'absorb' };
  assert.equal(evaluateCircuit(game, level).checks[1], true);
});

test('the earlier LED circuit remains a reusable model outside the course catalog', () => {
  const legacy = makeGpioLedLevel({ id: 982, title: 'LED', chapter: '测试', chapterSubtitle: '测试',
    story: '测试', voltageV: 3.3, ledForwardV: 2, resistorOptionsOhms: [100, 330], warningCurrentMa: 20 });
  const game = { ...startGame(true, legacy), resistorOhms: 330 };
  assert.equal(evaluateCircuit(game, legacy).kind, 'success');
  assert.equal(evaluateCircuit(game, legacy).componentStates.led.state, 'lit');
});

const PROBE_AT_NODE_A = Object.freeze({ target: 'nodeA' });

test('level 2 solves a two-node ladder with a controlled injector', () => {
  const level = getLevel(2);
  const game = startGame(true, level);
  const report = evaluateCircuit(game, level);
  assert.equal(report.kind, 'success');
  assert.equal(report.success, true);
  // Reference: R1 = R2 = R3 = 1 kΩ and g = 0.5 mS.
  near(report.network.nodeBV, 3.6);
  near(report.network.nodeAV, 7.2);
  near(report.network.controlledSourceControlV, 3.6);
  near(report.network.controlledSourceCurrentMa, 1.8);
  near(report.network.controlledTransconductanceMs, 0.5);
  // KCL at A: 1.8 mA through R1 + 1.8 mA injected = 3.6 mA on to node B.
  near(report.network.r1CurrentMa, 1.8);
  near(report.network.r2CurrentMa, 3.6);
  near(report.network.r3CurrentMa, 3.6);
  near(Object.values(report.network.elementPowerMw).reduce((sum, value) => sum + value, 0), 0);
  assert.equal(report.componentStates.vccs.state, 'conducting');
});

test('level 2 needs both the gain knob and the resistor values', () => {
  const level = getLevel(2);
  const reference = () => {
    const game = startGame(true, level);
    game.resistorValues = { ...level.electrical.referenceOhms };
    return game;
  };
  // Reference values but the knob left at its default: not enough current.
  const lowGain = reference();
  lowGain.controlledGmMs = level.electrical.defaultTransconductanceMs;
  const lowReport = evaluateCircuit(lowGain, level);
  assert.equal(lowReport.success, false);
  near(lowReport.network.nodeBV, 3.273);
  // Right knob but the default (unequal) values: the ladder is not 1:1:1.
  const defaults = startGame(true, level);
  defaults.resistorValues = { ...level.electrical.defaultOhms };
  const defaultReport = evaluateCircuit(defaults, level);
  assert.equal(defaultReport.success, false);
  near(defaultReport.network.nodeBV, 4.696);
  // Both right: clears.
  assert.equal(evaluateCircuit(reference(), level).success, true);
});

test('the output always equals g·U控制, whatever the knob and the network', () => {
  const level = getLevel(2);
  const game = startGame(true, level);
  game.controlledGmMs = 0.75;
  const report = evaluateCircuit(game, level);
  near(report.network.controlledTransconductanceMs, 0.75);
  near(report.network.controlledSourceCurrentMa, 0.75 * report.network.controlledSourceControlV);
  near(report.network.controlledSourceCurrentMa, 3);
  assert.equal(report.success, false);
});

test('level 2 feedback names the control quantity and the knob', () => {
  const level = getLevel(2);
  const game = startGame(true, level);
  game.resistorValues = { ...level.electrical.referenceOhms };
  game.controlledGmMs = level.electrical.defaultTransconductanceMs;
  const report = evaluateCircuit(game, level);
  assert.equal(report.success, false);
  // Wiring and values are the reference ones; only the gain is still at default.
  assert.match(report.observed, /节点 B（控制量）约 3\.27 V/);
  assert.match(report.observed, /当前 g = 0\.25 mS/);
  assert.match(report.nextStep, /跨导 g/);
});

test('a controlled source cannot excite a circuit on its own', () => {
  // The control quantity comes from the network, so with the supply gone there is
  // nothing to control: no output at all, never a nominal value.
  const level = getLevel(2);
  const game = startGame(true, level);
  game.wires = ['nodeA-r2.a', 'r2.b-nodeB', 'nodeB-r3.a', 'r3.b-ground', 'vccs.out-nodeA', 'vccs.in-ground'];
  const report = evaluateCircuit(game, level);
  assert.equal(report.success, false);
  near(report.network.nodeBV, 0);
  near(report.network.controlledSourceControlV, 0);
  near(report.network.controlledSourceCurrentMa, 0);
});

test('a controlled source left out of the circuit outputs nothing', () => {
  const level = getLevel(2);
  const game = startGame(true, level);
  game.wires = ['power-r1.a', 'r1.b-nodeA', 'nodeA-r2.a', 'r2.b-nodeB', 'nodeB-r3.a', 'r3.b-ground'];
  const report = evaluateCircuit(game, level);
  assert.equal(report.success, false);
  assert.deepEqual(report.checks, [false, false]);
  near(report.network.nodeBV, 3);
  assert.equal(report.network.controlledSourceCurrentMa, null);
  assert.equal(report.componentStates.vccs.state, 'open');
  assert.match(report.observed, /不输出/);
});

test('the probe is a measuring tool, never an objective', () => {
  // Every level is judged from the circuit alone: where the probe sits, or
  // whether it has been placed at all, must not change the verdict.
  for (const id of [1, 2, 3]) {
    const level = getLevel(id);
    const solved = startGame(true, level);
    assert.equal(evaluateCircuit(solved, level).success, true, 'level ' + id + ' without a probe');
    assert.equal(evaluateCircuit(solved, level, { target: 'nodeA' }).success, true, 'level ' + id + ' with the probe on node A');
    assert.equal(evaluateCircuit(solved, level, { target: level.circuit.resistors[0] + '.b' }).success, true, 'level ' + id + ' with the probe elsewhere');
    const broken = startGame(true, level);
    broken.wires = broken.wires.filter(wire => wire !== level.circuit.solutionWires.at(-1));
    assert.equal(evaluateCircuit(broken, level, { target: 'nodeA' }).success, false, 'level ' + id + ' cannot be probed into passing');
  }
});

test('an equivalent build clears level 2 as well', () => {
  const level = getLevel(2);
  const game = startGame(true, level);
  game.placed = { ...game.placed, r1: true, r2: true, r3: true, r4: true };
  game.positions = { ...game.positions, r4: { x: 345, y: 255 } };
  // R1 built as 2 kΩ ∥ 2 kΩ = 1 kΩ; R2 and R3 stay 1 kΩ.
  game.resistorValues = { r1: 2000, r2: 1000, r3: 1000, r4: 2000 };
  game.wires = ['power-r1.a', 'r1.b-nodeA', 'power-r4.a', 'r4.b-nodeA',
    'nodeA-r2.a', 'r2.b-nodeB', 'nodeB-r3.a', 'r3.b-ground', 'vccs.out-nodeA', 'vccs.in-ground'];
  const report = evaluateCircuit(game, level);
  assert.equal(report.success, true, report.kind + ': ' + report.observed);
  near(report.network.nodeBV, 3.6);
  near(report.network.controlledSourceCurrentMa, 1.8);
});

test('an extra branch changes the operating point and the controlled output', () => {
  const level = getLevel(2);
  const game = startGame(true, level);
  game.placed = { ...game.placed, r4: true };
  game.positions = { ...game.positions, r4: { x: 620, y: 527 } };
  game.resistorValues.r4 = 1000;
  // R3 ∥ R4 = 500 Ω breaks the 1:1:1 ladder.
  game.wires = [...level.circuit.solutionWires, 'nodeB-r4.a', 'r4.b-ground'];
  const report = evaluateCircuit(game, level);
  assert.equal(report.success, false);
  near(report.network.nodeBV, 2);
  near(report.network.controlledSourceCurrentMa, 1);
});

test('level 3 is a power-budget build: the same 300 Ω passes only if the part can take it', () => {
  const level = getLevel(3);
  const build = ({ r1 = 600, r3 = 600, ratings = {}, extraWires = [] } = {}) => {
    const game = startGame(true, level);
    game.placed = { ...game.placed, r1: true, r2: true, r3: r3 !== null };
    game.resistorValues = { ...game.resistorValues, r1, r2: 100, ...(r3 !== null ? { r3 } : {}) };
    game.resistorRatings = ratings;
    game.wires = r3 === null
      ? ['power-r1.a', 'r1.b-nodeA', 'nodeA-r2.a', 'r2.b-ground']
      : ['power-r1.a', 'r1.b-nodeA', 'power-r3.a', 'r3.b-nodeA', 'nodeA-r2.a', 'r2.b-ground', ...extraWires];
    return game;
  };
  // The reference: two ¼ W parts share the 30 mA, so each only takes 135 mW.
  const reference = evaluateCircuit(build(), level);
  assert.equal(reference.kind, 'success');
  near(reference.network.nodeAV, 3);
  near(reference.network.r2PowerMw, 90);
  near(reference.network.resistorResults.r1.powerW * 1000, 135);
  // One 300 Ω carries everything: 270 mW, over the ¼ W rating.
  const single = evaluateCircuit(build({ r1: 300, r3: null }), level);
  assert.equal(single.kind, 'resistor-overload');
  assert.match(single.observed, /R1 270 mW \/ 250 mW/);
  // …but the very same 300 Ω is fine as a ½ W part: the second way to fix stress.
  const heavy = evaluateCircuit(build({ r1: 300, r3: null, ratings: { r1: 0.5 } }), level);
  assert.equal(heavy.kind, 'success');
  near(heavy.network.resistorResults.r1.powerW * 1000, 270);
  near(heavy.network.resistorResults.r1.ratedPowerW, 0.5);
  assert.match(heavy.explanation, /½ W/);
  // A safe but wrong value fails the readings instead (the other failure mode).
  const offTarget = evaluateCircuit(build({ r1: 600, r3: null }), level);
  assert.equal(offTarget.kind, 'target-mismatch');
  near(offTarget.network.nodeAV, 1.714);
  assert.ok(offTarget.network.resistorResults.r1.powerW * 1000 < 250);
});

test('level 3 rates every part on its own, and the load is fixed', () => {
  const level = getLevel(3);
  assert.deepEqual(level.electrical.resistorRatingOptionsW, [0.25, 0.5]);
  assert.equal(level.electrical.resistorRatedPowerW, 0.25);
  assert.equal(level.circuit.load, 'r2');
  const game = startGame(false, level);
  assert.equal(game.placed.r2, true, 'the load is on the board from the start');
  assert.ok(!game.placed.r1 && !game.placed.r3);
  assert.deepEqual(game.resistorRatings, {}, 'ratings start at the level default');
  assert.equal(game.resistorValues.r2, 100);
  // The default values do not solve it: a freshly dropped part is 1 kΩ, so the
  // series element is way off target even before the rating is considered.
  const dropped = startGame(true, level);
  dropped.resistorValues = { ...level.electrical.defaultOhms };
  dropped.placed = { ...dropped.placed, r1: true, r2: true, r3: false };
  dropped.wires = ['power-r1.a', 'r1.b-nodeA', 'nodeA-r2.a', 'r2.b-ground'];
  const droppedReport = evaluateCircuit(dropped, level);
  assert.equal(droppedReport.kind, 'target-mismatch');
  near(droppedReport.network.nodeAV, 1.091);
  // And one 300 Ω at ¼ W is a fault, not an answer.
  const defaults = startGame(true, level);
  defaults.resistorValues = { ...level.electrical.defaultOhms };
  defaults.placed = { ...defaults.placed, r1: true, r2: true, r3: false };
  defaults.resistorValues = { r1: 300, r2: 100, r3: 300 };
  defaults.wires = ['power-r1.a', 'r1.b-nodeA', 'nodeA-r2.a', 'r2.b-ground'];
  assert.equal(evaluateCircuit(defaults, level).kind, 'resistor-overload');
  // The overload message names the part, its actual power and its own rating.
  const report = evaluateCircuit(defaults, level);
  assert.match(report.explanation, /¼ W|½ W|额定功率更大的器件/);
});

test('a plain ladder without the controlled source never clears level 2', () => {
  const level = getLevel(2);
  const game = startGame(true, level);
  game.resistorValues = { ...level.electrical.referenceOhms };
  game.wires = ['power-r1.a', 'r1.b-nodeA', 'nodeA-r2.a', 'r2.b-nodeB', 'nodeB-r3.a', 'r3.b-ground'];
  const report = evaluateCircuit(game, level);
  assert.equal(report.checks[1], false);
  assert.equal(report.success, false);
});

test('a bypassed series resistor is reported as a short, not as an open branch', () => {
  const level = getLevel(1);
  const game = startGame(true, level);
  game.wires.push('power-nodeA');
  const report = evaluateCircuit(game, level);
  assert.equal(report.kind, 'resistor-short');
  assert.equal(report.success, false);
  near(report.network.nodeAV, 12);
  near(report.network.r1CurrentMa, 0);
  // The bypass carries R2's 12 mA and the current source's 6 mA, so the source
  // delivers 18 mA: 144 mW into R2 plus 72 mW into the charged current source.
  near(report.network.voltageSourceCurrentMa, 18);
  near(report.network.elementPowerMw.power, -216);
  near(Object.values(report.network.elementPowerMw).reduce((sum, value) => sum + value, 0), 0);
  assert.match(report.headline, /R1/);
});
