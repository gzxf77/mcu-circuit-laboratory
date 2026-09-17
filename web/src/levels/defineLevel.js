// Level files are data, not executable rules. New component types and electrical
// models are registered in the engine once and then reused by level data.
import { boardToolIds, componentCatalog } from '../componentCatalog.js';

const knownParts = new Set(Object.keys(componentCatalog));
const knownTools = new Set(boardToolIds);
const conditionTypes = new Set(['all', 'any', 'placed', 'wire', 'orientation', 'allowedWires', 'currentUnder', 'currentBetween', 'resistorPowerUnder', 'resistorSelected', 'resistorValuesSelected', 'metricBetween', 'networkSafe', 'probeAt', 'pathKind', 'goal']);

const assert = (valid, message) => { if (!valid) throw new Error('Invalid level: ' + message); };
const endpointPart = endpoint => endpoint.split('.')[0];
const validEndpoint = endpoint => Boolean(componentCatalog[endpointPart(endpoint)]?.terminals[endpoint]);

function validateCondition(condition, goalIds, partIds) {
  assert(condition && typeof condition === 'object' && !Array.isArray(condition), 'goal condition must be an object');
  const keys = Object.keys(condition);
  assert(keys.length === 1 && conditionTypes.has(keys[0]), 'unknown goal condition ' + keys.join(','));
  const type = keys[0];
  const value = condition[type];
  if (type === 'all' || type === 'any') {
    assert(Array.isArray(value) && value.length > 0, type + ' needs conditions');
    value.forEach(item => validateCondition(item, goalIds, partIds));
  } else if (type === 'placed') {
    assert(partIds.has(value), 'unknown part in ' + type);
  } else if (type === 'orientation') {
    assert(value === 'forward' || value === 'reverse', 'invalid orientation');
  } else if (type === 'wire') {
    assert(Array.isArray(value) && value.length === 2 && value.every(pin => partIds.has(endpointPart(pin)) && validEndpoint(pin)), 'invalid wire condition');
  } else if (type === 'goal') {
    assert(goalIds.has(value), 'unknown goal reference ' + value);
  } else if (type === 'currentUnder') {
    assert(Number.isFinite(value) && value > 0, 'invalid current threshold');
  } else if (type === 'resistorPowerUnder') {
    assert(Number.isFinite(value) && value > 0, 'invalid resistor power threshold');
  } else if (type === 'currentBetween') {
    assert(value && Number.isFinite(value.min) && value.min >= 0 && Number.isFinite(value.max) && value.max > value.min, 'invalid current range');
  } else if (type === 'metricBetween') {
    assert(value && typeof value.key === 'string' && Number.isFinite(value.min) && Number.isFinite(value.max) && value.max > value.min, 'invalid metric range');
  } else if (type === 'probeAt') {
    assert(typeof value === 'string' && partIds.has(endpointPart(value)) && validEndpoint(value), 'invalid probe target');
  } else if (type === 'pathKind') {
    assert(typeof value === 'string', 'invalid path kind');
  } else {
    assert(value === true, type + ' must be true');
  }
}

export function defineLevel(level) {
  assert(Number.isInteger(level.id) && level.id > 0, 'id must be a positive integer');
  assert(typeof level.title === 'string' && level.title.length > 0, 'title is required');
  assert(typeof level.model === 'string', 'model is required');
  assert(typeof level.initialReversed === 'boolean', 'initialReversed must be a boolean');
  assert(Array.isArray(level.parts) && level.parts.length > 0, 'parts are required');
  assert(new Set(level.parts.map(part => part.id)).size === level.parts.length, 'duplicate part id');
  const partIds = new Set(level.parts.filter(part => knownParts.has(part.id)).map(part => part.id));
  assert(level.parts.every(part => knownParts.has(part.id) || knownTools.has(part.id)), 'unsupported part');
  assert(level.parts.some(part => part.id === 'wire'), 'wire tool is required');
  assert(level.parts.some(part => part.id === 'probe'), 'probe tool is required');
  assert(Array.isArray(level.board?.fixedParts || []) && (level.board?.fixedParts || []).every(id => partIds.has(id)), 'fixed parts must be listed components');
  const electrical = level.electrical;
  if (level.model === 'resistor-dc-v1') {
    assert(Number.isFinite(electrical?.sourceV) && electrical.sourceV > 0, 'source voltage must be positive');
    assert(Number.isFinite(electrical.resistorRatedPowerW) && electrical.resistorRatedPowerW > 0, 'resistor rated power must be positive');
    assert(Array.isArray(electrical.resistorOptionsOhms) && electrical.resistorOptionsOhms.length > 0 && electrical.resistorOptionsOhms.every(value => Number.isFinite(value) && value > 0), 'invalid resistor choices');
    assert(level.circuit?.resistors?.length >= 2 && level.circuit.resistors.every(id => partIds.has(id)), 'resistor parts are required');
    assert(level.circuit.resistors.every(id => Number.isFinite(electrical.referenceOhms?.[id]) && electrical.referenceOhms[id] > 0), 'reference resistor values are required');
    assert(level.circuit.resistors.every(id => electrical.resistorOptionsOhms.includes(electrical.defaultOhms?.[id])), 'default resistor values must be available choices');
    assert(partIds.has(level.circuit.source) && partIds.has(level.circuit.ground), 'source and ground are required');
    assert(partIds.has(endpointPart(level.circuit.nodeA)) && validEndpoint(level.circuit.nodeA), 'node A endpoint is required');
    assert(level.board?.positions && [...partIds].every(id => Number.isFinite(level.board.positions[id]?.x) && Number.isFinite(level.board.positions[id]?.y)), 'every part needs a board position');
    assert(Array.isArray(level.circuit.solutionWires) && level.circuit.solutionWires.length > 0, 'solution wires are required');
    for (const wire of level.circuit.solutionWires) {
      const pins = wire.split('-');
      assert(pins.length === 2 && pins.every(pin => partIds.has(endpointPart(pin)) && validEndpoint(pin)), 'invalid solution wire ' + wire);
    }
    assert(Array.isArray(level.goals) && level.goals.length > 0, 'goals are required');
    const goalIds = new Set(level.goals.map(goal => goal.id));
    assert(goalIds.size === level.goals.length, 'duplicate goal id');
    level.goals.forEach(goal => validateCondition(goal.when, goalIds, partIds));
    return Object.freeze(level);
  }
  assert(electrical && ['gpioHighV', 'ledForwardV', 'warningCurrentMa'].every(key => Number.isFinite(electrical[key]) && electrical[key] > 0), 'electrical parameters must be positive numbers');
  assert(Number.isFinite(electrical.resistorRatedPowerW) && electrical.resistorRatedPowerW > 0, 'resistor rated power must be positive');
  assert(Number.isFinite(electrical.ledVisualFullScaleMa) && electrical.ledVisualFullScaleMa > 0, 'LED visual full scale must be positive');
  assert(electrical.gpioHighV > electrical.ledForwardV, 'GPIO voltage must exceed LED forward voltage');
  const options = electrical.resistorOptionsOhms;
  const selectable = Array.isArray(options);
  if (selectable) {
    assert(electrical.resistorOhms === null && options.length > 0 && new Set(options).size === options.length && options.every(value => Number.isFinite(value) && value > 0), 'invalid resistor choices');
    const min = electrical.minimumCurrentMa;
    assert(min === null || (Number.isFinite(min) && min >= 0 && min < electrical.warningCurrentMa), 'invalid target current range');
    assert(options.some(value => {
      const current = (electrical.gpioHighV - electrical.ledForwardV) / value * 1000;
      const resistorPowerW = (current / 1000) ** 2 * value;
      return (min === null || current >= min) && current < electrical.warningCurrentMa && resistorPowerW <= electrical.resistorRatedPowerW;
    }), 'no resistor choice can meet the current target');
  } else {
    assert(Number.isFinite(electrical.resistorOhms) && electrical.resistorOhms > 0, 'fixed resistor must be positive');
    assert(electrical.minimumCurrentMa === null, 'minimum current needs resistor choices');
    assert((electrical.gpioHighV - electrical.ledForwardV) / electrical.resistorOhms * 1000 < electrical.warningCurrentMa, 'fixed resistor cannot meet the current limit');
    assert((electrical.gpioHighV - electrical.ledForwardV) ** 2 / electrical.resistorOhms <= electrical.resistorRatedPowerW, 'fixed resistor exceeds rated power');
  }
  assert(level.board?.positions && [...partIds].every(id => Number.isFinite(level.board.positions[id]?.x) && Number.isFinite(level.board.positions[id]?.y)), 'every part needs a board position');
  assert(Array.isArray(level.circuit?.solutionWires) && level.circuit.solutionWires.length > 0, 'solution wires are required');
  assert(Array.isArray(level.circuit.baseWires) && level.circuit.baseWires.length === 2, 'two MCU supply wires are required');
  assert(level.circuit.baseWires.every(wire => level.circuit.solutionWires.includes(wire)), 'supply wires must be in the solution');
  for (const wire of level.circuit.solutionWires) {
    const pins = wire.split('-');
    assert(pins.length === 2 && pins.every(pin => partIds.has(endpointPart(pin)) && validEndpoint(pin)), 'invalid solution wire ' + wire);
  }
  if (level.measurement) {
    assert(partIds.has(endpointPart(level.measurement.target)) && validEndpoint(level.measurement.target) && typeof level.measurement.label === 'string', 'invalid measurement target');
  }
  assert(level.concept === null || typeof level.concept === 'string', 'concept must be text');
  assert(Array.isArray(level.experiments) && level.experiments.every(item => typeof item === 'string' && item.length > 0), 'experiments must be text');
  assert(Array.isArray(level.goals) && level.goals.length > 0, 'goals are required');
  const goalIds = new Set(level.goals.map(goal => goal.id));
  assert(goalIds.size === level.goals.length, 'duplicate goal id');
  for (const goal of level.goals) {
    assert(typeof goal.label === 'string' && goal.label.length > 0, 'goal label is required');
    validateCondition(goal.when, goalIds, partIds);
  }
  return Object.freeze(level);
}
