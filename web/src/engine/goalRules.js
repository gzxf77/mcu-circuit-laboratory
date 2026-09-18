// Small declarative rule vocabulary shared by every level. Level data supplies
// conditions; no level-specific if/else belongs in the UI.
export function evaluateGoals(level, game, currentPath, normalizeWire, probe = null, context = null) {
  const wires = new Set(game.wires.map(normalizeWire));
  const allowedWires = new Set(level.circuit.solutionWires.map(normalizeWire));
  const byId = new Map(level.goals.map(goal => [goal.id, goal]));
  const cache = new Map();
  const visiting = new Set();
  const evaluateGoal = id => {
    if (cache.has(id)) return cache.get(id);
    if (visiting.has(id)) throw new Error('Circular goal reference: ' + id);
    const goal = byId.get(id);
    if (!goal) throw new Error('Unknown goal: ' + id);
    visiting.add(id);
    const result = evaluateCondition(goal.when);
    visiting.delete(id);
    cache.set(id, result);
    return result;
  };
  const evaluateCondition = condition => {
    if (condition.all) return condition.all.every(evaluateCondition);
    if (condition.any) return condition.any.some(evaluateCondition);
    if (condition.placed) return Boolean(game.placed[condition.placed]);
    if (condition.wire) return wires.has(normalizeWire(condition.wire.join('-')));
    if (condition.orientation) return condition.orientation === 'forward' ? !game.reversed : game.reversed;
    if (condition.allowedWires) return game.wires.every(wire => allowedWires.has(normalizeWire(wire)));
    if (condition.currentUnder) return currentPath?.currentMa < condition.currentUnder;
    if (condition.currentBetween) return currentPath?.currentMa >= condition.currentBetween.min && currentPath.currentMa < condition.currentBetween.max;
    if (condition.resistorPowerUnder) return currentPath?.resistorPowerW <= condition.resistorPowerUnder;
    if (condition.resistorSelected) return Number.isFinite(game.resistorOhms) && game.resistorOhms > 0;
    if (condition.resistorValuesSelected) return context?.allSelected === true;
    if (condition.seriesConducting) return context?.seriesConducting === true;
    if (condition.metricBetween) {
      const value = context?.[condition.metricBetween.key];
      return Number.isFinite(value) && value >= condition.metricBetween.min && value <= condition.metricBetween.max;
    }
    if (condition.networkSafe) return context?.networkSafe === true;
    if (condition.probeAt) return probe?.target === condition.probeAt && game.placed[condition.probeAt.split('.')[0]];
    if (condition.pathKind) return currentPath?.kind === condition.pathKind;
    if (condition.goal) return evaluateGoal(condition.goal);
    throw new Error('Unsupported goal condition');
  };
  return level.goals.map(goal => Boolean(evaluateGoal(goal.id)));
}
