import test from 'node:test';
import assert from 'node:assert/strict';
import { snapProbe } from '../src/circuitGeometry.js';
import { evaluateCircuit, startGame } from '../src/evaluateCircuit.js';
import { defaultProbe, readProbe } from '../src/probeModel.js';

const withSelectedResistor = (solved = false) => ({ ...startGame(solved), resistorOhms: 330 });
const measure = (game, target) => readProbe(game, evaluateCircuit(game), { target });

test('the level opens empty and an unplaced probe has no trace', () => {
  const game = startGame(false);
  assert.ok(Object.values(game.placed).every(value => value === false));
  assert.equal(defaultProbe.target, null);
  assert.equal(readProbe(game, evaluateCircuit(game), null).waveform, 'idle');
});

test('a finished circuit exposes distinct power, GPIO, LED and ground traces', () => {
  const game = withSelectedResistor(true);
  assert.deepEqual(['power', 'mcu.gpio', 'resistor.a', 'led.a', 'led.b', 'ground'].map(target => {
    const { voltageV, waveform } = measure(game, target);
    return [voltageV, waveform];
  }), [
    [3.3, 'flat'], [3.3, 'step'], [3.3, 'step'], [2, 'step'], [0, 'flat'], [0, 'flat'],
  ]);
  assert.deepEqual(['mcu.gpio', 'resistor.a', 'led.a', 'ground'].map(target => measure(game, target).currentLabel),
    ['约 3.9 mA', '约 3.9 mA', '约 3.9 mA', '约 3.9 mA']);
});

test('a reversed LED has no current and approximately no resistor voltage drop', () => {
  const game = withSelectedResistor(true);
  game.reversed = true;
  const reading = measure(game, 'resistor.b');
  assert.equal(reading.voltageV, 3.3);
  assert.equal(reading.waveform, 'step');
  assert.equal(reading.currentLabel, '0 mA');
});

test('a GPIO short and an unconnected point do not claim a normal voltage', () => {
  const shorted = startGame(false);
  Object.assign(shorted.placed, { mcu: true, power: true, ground: true });
  shorted.wires.push('power-mcu.vdd', 'mcu.gnd-ground', 'mcu.gpio-ground');
  assert.equal(measure(shorted, 'mcu.gpio').waveform, 'unknown');
  assert.equal(measure(shorted, 'mcu.gpio').currentLabel, '无法确定');
  assert.equal(measure(startGame(false), 'led.a').voltageV, null);
  const supplyShort = startGame(false);
  Object.assign(supplyShort.placed, { power: true, ground: true });
  supplyShort.wires.push('power-ground');
  assert.equal(measure(supplyShort, 'ground').waveform, 'unknown');
  assert.equal(measure(supplyShort, 'ground').currentLabel, '无法确定');
});

test('the probe shows resistor-branch current even before the LED goal is met', () => {
  const game = withSelectedResistor();
  Object.assign(game.placed, { mcu: true, power: true, ground: true, resistor: true, led: true });
  game.wires.push('power-mcu.vdd', 'mcu.gnd-ground', 'mcu.gpio-resistor.a', 'resistor.b-ground');
  assert.equal(evaluateCircuit(game).success, false);
  assert.equal(measure(game, 'resistor.b').currentLabel, '约 10.0 mA');
  assert.equal(measure(game, 'led.a').currentLabel, '0 mA');
  assert.equal(measure(game, 'led.a').currentMa, 0);
  assert.equal(readProbe(game, evaluateCircuit(game), { ...defaultProbe }).currentLabel, '—');
});

test('power and GPIO readings update from the current wiring without an inspect step', () => {
  const game = startGame(false);
  game.placed.power = true;
  game.placed.mcu = true;
  game.placed.ground = true;
  assert.equal(measure(game, 'power').voltageV, 3.3);
  assert.equal(measure(game, 'mcu.gpio').voltageV, null);
  game.wires.push('power-mcu.vdd', 'mcu.gnd-ground');
  assert.equal(measure(game, 'mcu.gpio').voltageV, 3.3);
  assert.equal(measure(game, 'mcu.gpio').waveform, 'step');
});

test('probe only snaps to components actually placed on the board', () => {
  const game = startGame(false);
  assert.equal(snapProbe(game, { x: 276, y: 335 }).target, null);
  game.placed.mcu = true;
  assert.equal(snapProbe(game, { x: 276, y: 335 }).target, 'mcu.gpio');
  game.positions.mcu = { x: 225, y: 385 };
  assert.equal(snapProbe(game, { x: 325, y: 383 }).target, 'mcu.gpio');
});

test('the probe snaps to ports and connected wires, and can leave the circuit', () => {
  const game = withSelectedResistor(true);
  assert.equal(snapProbe(game, { x: 605, y: 334 }).target, 'led.a');
  const wire = snapProbe(game, { x: 568, y: 333 });
  assert.equal(wire.target, 'resistor.b');
  assert.equal(wire.wire, 'led.a-resistor.b');
  assert.equal(readProbe(game, evaluateCircuit(game), wire).currentLabel, '约 3.9 mA');
  assert.equal(wire.y, 332);
  assert.equal(snapProbe(game, { x: 520, y: 590 }).target, null);
});
