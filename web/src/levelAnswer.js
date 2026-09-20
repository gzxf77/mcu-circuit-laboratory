// The reference answer for the active level, built from the level's own data —
// never hardcoded per level. Wiring, values, readings and (where a level asks for
// them) the power judgements all come from solving `startGame(true, level)`, which
// is the same reference build the tests and the level catalog use.
import { componentSpec } from './componentCatalog.js';
import { evaluateCircuit, startGame } from './evaluateCircuit.js';

const terminalNames = { a: '左端', b: '右端', in: '流回端', out: '流出端' };

export function terminalLabel(pin) {
  const [part, terminal] = String(pin).split('.');
  const known = part === 'power' ? '电源' : part === 'ground' ? 'GND'
    : part === 'nodeA' ? '节点 A' : part === 'nodeB' ? '节点 B'
      : part === 'isource' ? '电流源' : part === 'vccs' ? '受控源'
        : part === 'mcu' ? 'MCU' : part.toUpperCase();
  if (!terminal) return known;
  return known + ' · ' + (terminalNames[terminal] || terminal);
}

const elementLabel = (id, level) => id === level.circuit.source ? '电源'
  : id === level.circuit.currentSource?.id ? '电流源'
    : id === level.circuit.controlledSource?.id ? '受控源' : terminalLabel(id);

const ohmsText = ohms => ohms >= 1000 ? (ohms / 1000) + ' kΩ' : ohms + ' Ω';

export function referenceAnswer(level, liveGame = null) {
  const currentGainMs = liveGame?.controlledGmMs ?? null;
  const game = startGame(true, level);
  const report = evaluateCircuit(game, level);
  const network = report.network || {};
  const wires = (level.circuit.solutionWires || []).map(wire => {
    const [from, to] = wire.split('-');
    return terminalLabel(from) + ' → ' + terminalLabel(to);
  });
  // A candidate level's answer is just the reference scheme: listing a resistor
  // that scheme does not use would be noise (and looks like an instruction).
  const referenceCandidate = (level.circuit?.candidates || []).find(candidate =>
    candidate.wires.length === (level.circuit.solutionWires || []).length &&
    candidate.wires.every(wire => level.circuit.solutionWires.includes(wire))) || null;
  const valueIds = referenceCandidate
    ? [...Object.keys(referenceCandidate.values), ...(level.circuit.load ? [level.circuit.load] : [])]
    : Object.keys(level.electrical.referenceOhms || {});
  const ratingOptions = level.electrical.resistorRatingOptionsW;
  const values = valueIds
    .filter(id => Number.isFinite(level.electrical.referenceOhms?.[id]))
    .sort((first, second) => (Number(first.replace(/\D/g, '')) || 0) - (Number(second.replace(/\D/g, '')) || 0))
    .map(id => ({
      id,
      text: id.toUpperCase() + ' = ' + ohmsText(level.electrical.referenceOhms[id])
        // The rated power of a part is part of the answer when the level lets the
        // player choose it.
        + (ratingOptions && id !== level.circuit.load
          ? ' · ' + (level.electrical.resistorRatedPowerW * 1000).toFixed(0) + ' mW（可选 ' + ratingOptions.map(value => (value * 1000).toFixed(0)).join(' / ') + ' mW）'
          : ''),
    }));
  // Anything the player can tune is part of the answer too: resistor values alone
  // are not enough when a level hands out a knob.
  if (level.circuit.controlledSource) {
    const reference = level.electrical.controlledTransconductanceMs;
    const current = currentGainMs ?? reference;
    values.push({
      id: 'gain',
      text: '跨导 g = ' + reference.toFixed(2) + ' mS'
        + (Math.abs(current - reference) > 1e-9 ? '（当前 ' + current.toFixed(2) + ' mS）' : ''),
    });
  }
  const readings = [];
  if (Number.isFinite(network.nodeAV) && level.circuit.nodeA) readings.push({ label: '节点 A 电压', text: network.nodeAV.toFixed(2) + ' V' });
  if (Number.isFinite(network.voltageSourceCurrentMa) && level.circuit.source) readings.push({ label: '电压源输出电流', text: network.voltageSourceCurrentMa.toFixed(2) + ' mA' });
  if (Number.isFinite(network.currentSourceVoltageV) && level.circuit.currentSource) readings.push({ label: '电流源端电压', text: network.currentSourceVoltageV.toFixed(2) + ' V' });
  if (Number.isFinite(network.controlledSourceCurrentMa) && level.circuit.controlledSource) {
    readings.push({ label: '受控源输出', text: network.controlledSourceCurrentMa.toFixed(2) + ' mA' });
    readings.push({ label: '受控源控制量', text: (network.controlledSourceControlV ?? 0).toFixed(2) + ' V' });
  }
  if (Number.isFinite(network.totalCurrentMa) && !level.circuit.currentSource && !level.circuit.controlledSource) readings.push({ label: '总电流', text: network.totalCurrentMa.toFixed(2) + ' mA' });
  if (Number.isFinite(network.equivalentOhms)) readings.push({ label: '等效电阻', text: network.equivalentOhms.toFixed(0) + ' Ω' });
  const powers = Object.entries(network.elementPowerMw || {})
    .filter(([, powerMw]) => Number.isFinite(powerMw))
    .map(([id, powerMw]) => ({ id, text: elementLabel(id, level) + (powerMw >= 0 ? ' 吸收 ' : ' 释放 ') + Math.abs(powerMw).toFixed(2) + ' mW' }));
  const judgements = Object.entries(game.powerJudging || {})
    .map(([id, verdict]) => ({ id, text: elementLabel(id, level) + '：' + (verdict === 'absorb' ? '吸收功率' : '释放功率') }));
  return { wires, values, readings, powers, judgements, report };
}

export function hasReferenceAnswer(level) {
  return Boolean(level?.circuit?.solutionWires?.length) &&
    Object.keys(level?.electrical?.referenceOhms || {}).length > 0;
}

// Kept for callers that only need to know a level can be described.
export const answerPartExists = id => Boolean(componentSpec(id));
