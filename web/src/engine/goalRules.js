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
    if (condition.metricBetween) {
      const value = context?.[condition.metricBetween.key];
      return Number.isFinite(value) && value >= condition.metricBetween.min && value <= condition.metricBetween.max;
    }
    if (condition.networkSafe) return context?.networkSafe === true;
    if (condition.branchCurrentsWithin) {
      // Each range must be satisfied by one measured parallel branch, in any
      // order, and the branch count must match — "分成 4 mA 与 2 mA 两条支路".
      const currents = Array.isArray(context?.branchCurrentsMa) ? context.branchCurrentsMa : [];
      const ranges = condition.branchCurrentsWithin;
      if (currents.length !== ranges.length) return false;
      const used = currents.map(() => false);
      const match = index => {
        if (index === ranges.length) return true;
        for (let position = 0; position < currents.length; position++) {
          if (used[position]) continue;
          const value = currents[position];
          if (value < ranges[index].min || value > ranges[index].max) continue;
          used[position] = true;
          if (match(index + 1)) return true;
          used[position] = false;
        }
        return false;
      };
      return match(0);
    }
    if (condition.probeAt) return probe?.target === condition.probeAt && game.placed[condition.probeAt.split('.')[0]];
    if (condition.powerJudged) {
      // A judgement goal: the player states, for one element, whether it absorbs
      // or delivers power. If the level gives the signs of u and i (e.g. textbook
      // problem 1-1), compute the truth from those signs and the reference
      // direction; otherwise fall back to the real circuit's measured power.
      const { id, expect } = condition.powerJudged;
      const signs = game.judgementSigns?.[id] ?? level.judgementSigns?.[id];
      let truth;
      if (signs) {
        const associated = !!context?.association?.[id];
        const product = (signs.u ?? 1) * (signs.i ?? 1);
        // Associated: P=ui, P>0 absorbs. Non-associated: ui directly is the
        // delivered power, so ui>0 means delivering.
        truth = associated ? (product >= 0 ? 'absorb' : 'deliver')
                           : (product >= 0 ? 'deliver' : 'absorb');
      } else {
        const powerMw = context?.elementPowerMw?.[id];
        if (!Number.isFinite(powerMw)) return false;
        truth = powerMw >= 0 ? 'absorb' : 'deliver';
      }
      // 随机符号/随机方向时真值动态变化，直接比对玩家答案，忽略关卡写死的 expect。
      return signs
        ? game.powerJudging?.[id] === truth
        : truth === expect && game.powerJudging?.[id] === expect;
    }
    if (condition.powerValueJudged) {
      const { id, expect } = condition.powerValueJudged;
      if (level.randomPick && game.picked && id !== game.picked) return true;
      const val = Number(game.powerValue?.[id]);
      return Number.isFinite(val) && Math.abs(val - expect) < 1e-6;
    }
    // 随机抽问：非本次抽到的元件直接算对。
    const cid = condition.powerJudged?.id || condition.assocJudged?.id || condition.uiMeaningJudged?.id;
    if (level.randomPick && game.picked && cid && cid !== game.picked) return true;
    if (condition.assocJudged) {
      // 题1-1(1): does the current arrow enter the + terminal? `in` = associated,
      // `out` = non-associated. The board's reference direction decides the truth.
      const { id, expect } = condition.assocJudged;
      const truth = context?.association?.[id] ? 'in' : 'out';
      if (level.ui?.randomDirection || level.abstract?.randomDirection) return game.assocJudging?.[id] === truth;
      return truth === expect && game.assocJudging?.[id] === expect;
    }
    if (condition.uiMeaningJudged) {
      // 题1-1(2): what does ui itself mean? Associated ⇒ ui = absorbed power;
      // non-associated ⇒ ui = delivered power.
      const { id, expect } = condition.uiMeaningJudged;
      const truth = context?.association?.[id] ? 'absorb' : 'deliver';
      if (level.ui?.randomDirection || level.abstract?.randomDirection) return game.uiMeaningJudging?.[id] === truth;
      return truth === expect && game.uiMeaningJudging?.[id] === expect;
    }
    if (condition.pathKind) return currentPath?.kind === condition.pathKind;
    if (condition.goal) return evaluateGoal(condition.goal);
    throw new Error('Unsupported goal condition');
  };
  return level.goals.map(goal => Boolean(evaluateGoal(goal.id)));
}
