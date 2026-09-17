import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCircuit, startGame } from '../src/evaluateCircuit.js';
import { estimateSeriesCurrentMa, expectedCurrentMa, levelElectrical } from '../src/levelElectrical.js';
import { estimateLedVisualBrightness } from '../src/componentStates.js';
import { makeGpioLedLevel } from '../src/levels/catalog.js';

const withSelectedResistor = (solved = false) => ({ ...startGame(solved), resistorOhms: 330 });

test('level current follows the LED voltage drop and Ohm\'s law', () => {
  assert.equal(expectedCurrentMa, null);
  assert.ok(Math.abs(estimateSeriesCurrentMa({ ...levelElectrical, resistorOhms: 330 }) - 3.9393939) < 0.001);
  assert.ok(Math.abs(estimateSeriesCurrentMa({ ...levelElectrical, resistorOhms: 1000 }) - 1.3) < 0.001);
  assert.equal(estimateSeriesCurrentMa({ ...levelElectrical, resistorOhms: 0 }), null);
});

test('a complete GPIO-resistor-LED path passes with a modest current', () => {
  const result = evaluateCircuit(withSelectedResistor(true));
  assert.equal(result.kind, 'success');
  assert.equal(result.success, true);
  assert.equal(result.currentLabel, '约 3.9 mA');
});

test('LED brightness follows its own modeled current, not the level result', () => {
  const readings = [1000, 330, 100, 47].map(resistorOhms =>
    evaluateCircuit({ ...startGame(true), resistorOhms }));
  const brightness = readings.map(report => report.componentStates.led.brightness);
  assert.ok(brightness[0] > 0 && brightness[0] < brightness[1]);
  assert.ok(brightness[1] < brightness[2] && brightness[2] < brightness[3]);
  assert.equal(readings[3].kind, 'current-out-of-range');
  assert.equal(readings[3].componentStates.led.state, 'lit');
  assert.equal(readings[1].componentStates.resistor.state, 'conducting');
  assert.ok(Math.abs(readings[1].componentStates.resistor.powerW - 0.005121) < 0.00001);
  assert.equal(estimateLedVisualBrightness(0, 15), 0);
  assert.equal(estimateLedVisualBrightness(100, 15), 1);
  assert.equal(estimateLedVisualBrightness(null, 15), 0);
});

test('component states turn off for a reversed LED and distinguish LED burnout', () => {
  const reversedGame = withSelectedResistor(true);
  reversedGame.reversed = true;
  const reversed = evaluateCircuit(reversedGame);
  assert.equal(reversed.componentStates.led.state, 'normal');
  assert.equal(reversed.componentStates.led.brightness, 0);
  assert.equal(reversed.componentStates.resistor.state, 'normal');

  const directGame = startGame(false);
  Object.assign(directGame.placed, { mcu: true, power: true, ground: true, led: true });
  directGame.wires.push('power-mcu.vdd', 'mcu.gnd-ground', 'mcu.gpio-led.a', 'led.b-ground');
  const direct = evaluateCircuit(directGame);
  assert.equal(direct.componentStates.led.state, 'burned');
  assert.equal(direct.componentStates.led.brightness, 0);
});

test('a resistor exceeds its own power rating before showing a burst state', () => {
  const level = makeGpioLedLevel({
    id: 982, title: '功率测试', chapter: '测试', chapterSubtitle: '测试', story: '测试',
    voltageV: 3.3, ledForwardV: 2, resistorOptionsOhms: [100, 330],
    warningCurrentMa: 20, resistorRatedPowerW: 0.01, ledVisualFullScaleMa: 5,
  });
  const game = { ...startGame(true, level), resistorOhms: 100 };
  const failed = evaluateCircuit(game, level);
  assert.equal(failed.kind, 'resistor-overload');
  assert.equal(failed.componentStates.resistor.state, 'burst');
  assert.ok(failed.componentStates.resistor.powerW > failed.componentStates.resistor.ratedPowerW);
  assert.equal(failed.componentStates.led.state, 'normal');
  assert.equal(failed.currentPath, null);
  assert.deepEqual(failed.flowEdges, []);
  assert.equal(failed.checks.at(-1), false);

  const safe = evaluateCircuit({ ...game, resistorOhms: 330 }, level);
  assert.equal(safe.kind, 'success');
  assert.equal(safe.componentStates.resistor.state, 'conducting');
  assert.equal(safe.componentStates.led.state, 'lit');
  assert.ok(safe.componentStates.led.brightness > evaluateCircuit({ ...startGame(true), resistorOhms: 330 }).componentStates.led.brightness);
});

test('a new level has no placed components or wires, and goals evaluate as incomplete', () => {
  const game = startGame(false);
  assert.ok(Object.values(game.placed).every(value => value === false));
  assert.deepEqual(game.wires, []);
  assert.equal(game.resistorOhms, null);
  assert.deepEqual(evaluateCircuit(game).checks, [false, false, false, false]);
});

test('a GPIO-to-resistor-to-ground branch carries current without completing the LED goal', () => {
  const game = withSelectedResistor();
  Object.assign(game.placed, { mcu: true, power: true, ground: true, resistor: true });
  game.wires.push('power-mcu.vdd', 'mcu.gnd-ground', 'mcu.gpio-resistor.a', 'resistor.b-ground');
  const result = evaluateCircuit(game);
  assert.equal(result.kind, 'missing-part');
  assert.equal(result.success, false);
  assert.equal(result.ledState, 'off');
  assert.equal(result.currentLabel, '约 10.0 mA');
  assert.equal(result.currentPath.kind, 'resistor-only');
  assert.deepEqual(result.flowEdges, [
    ['power', 'mcu.vdd'], ['mcu.gpio', 'resistor.a'],
    ['resistor.b', 'ground'], ['ground', 'mcu.gnd'],
  ]);
});

test('the resistor conducts in either orientation, but an open return or unpowered MCU does not', () => {
  const game = withSelectedResistor();
  Object.assign(game.placed, { mcu: true, power: true, ground: true, resistor: true });
  game.wires.push('power-mcu.vdd', 'mcu.gnd-ground', 'mcu.gpio-resistor.b', 'resistor.a-ground');
  assert.equal(evaluateCircuit(game).currentPath.resistorDirection, 'reverse');
  game.wires.pop();
  assert.deepEqual(evaluateCircuit(game).flowEdges, []);
  game.wires.push('resistor.a-ground');
  game.wires.shift();
  assert.deepEqual(evaluateCircuit(game).flowEdges, []);
});

test('a missing resistor without a closed LED path stays dark and is not burned', () => {
  const game = startGame(false);
  game.placed.led = true;
  const result = evaluateCircuit(game);
  assert.equal(result.kind, 'missing-part');
  assert.equal(result.ledState, 'off');
  assert.equal(result.currentLabel, '0 mA');
});

test('a direct forward GPIO-to-LED-to-ground path shows the modelled overcurrent failure', () => {
  const game = startGame(false);
  Object.assign(game.placed, { mcu: true, power: true, ground: true, led: true });
  game.wires.push('power-mcu.vdd', 'mcu.gnd-ground', 'mcu.gpio-led.a', 'led.b-ground');
  const result = evaluateCircuit(game);
  assert.equal(result.kind, 'overcurrent');
  assert.equal(result.ledState, 'burned');
  assert.equal(result.currentLabel, '过流风险');
  assert.equal(result.gpioWaveform, 'unknown');
});

test('bypassing a placed resistor is still an overcurrent path', () => {
  const game = withSelectedResistor(true);
  game.wires.push('mcu.gpio-led.a');
  const result = evaluateCircuit(game);
  assert.equal(result.kind, 'overcurrent');
});

test('a direct supply-to-LED path does not falsely mark GPIO0 as overloaded', () => {
  const game = startGame(false);
  Object.assign(game.placed, { mcu: true, power: true, ground: true, led: true });
  game.wires.push('power-mcu.vdd', 'mcu.gnd-ground', 'power-led.a', 'led.b-ground');
  const result = evaluateCircuit(game);
  assert.equal(result.kind, 'overcurrent');
  assert.equal(result.gpioWaveform, 'step');
});

test('a reverse LED is dark without a burn animation', () => {
  const game = withSelectedResistor(true);
  game.reversed = true;
  const result = evaluateCircuit(game);
  assert.equal(result.kind, 'reversed');
  assert.equal(result.ledState, 'off');
});

test('a GPIO-to-ground short has a different failure from LED overcurrent', () => {
  const game = withSelectedResistor();
  Object.assign(game.placed, { mcu: true, power: true, ground: true });
  game.wires.push('power-mcu.vdd', 'mcu.gnd-ground', 'mcu.gpio-ground');
  const result = evaluateCircuit(game);
  assert.equal(result.kind, 'gpio-short');
  assert.equal(result.ledState, 'off');
  assert.equal(result.gpioWaveform, 'unknown');
});

test('placed parts without the return wire form an open circuit', () => {
  const game = withSelectedResistor();
  Object.keys(game.placed).forEach(id => { game.placed[id] = true; });
  game.wires.push('power-mcu.vdd', 'mcu.gnd-ground', 'mcu.gpio-resistor.a', 'resistor.b-led.a');
  const result = evaluateCircuit(game);
  assert.equal(result.kind, 'open-circuit');
  assert.equal(result.currentLabel, '0 mA');
});
