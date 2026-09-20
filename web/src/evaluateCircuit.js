// Shared runtime for the DC resistor-network family. The app passes a level
// definition; this file contains no level numbers or fixed component values.
import { detectCurrentPath, wirePath } from './currentPaths.js';
import { resolveComponentStates } from './componentStates.js';
import { evaluateGoals } from './engine/goalRules.js';
import { electricalFor, estimateSeriesCurrentMa } from './levelElectrical.js';
import { defaultLevel } from './levels/catalog.js';
import { solveResistiveNetwork } from './resistiveNetwork.js';

export const wireKey = (a, b) => [a, b].sort().join('-');
export const normalizeWire = wire => wireKey(...wire.split('-'));

// Every power judgement a level asks for, as { id, expect }. The reference
// (solved) state answers them all, so the level's own reference build clears
// through exactly the same code path as the player's.
function judgedGoals(level) {
  const judged = [];
  const visit = condition => {
    if (!condition || typeof condition !== 'object') return;
    if (condition.powerJudged) judged.push(condition.powerJudged);
    for (const key of ['all', 'any']) (condition[key] || []).forEach(visit);
  };
  (level.goals || []).forEach(goal => visit(goal.when));
  return judged;
}

function judgedAnswers(level) {
  return Object.fromEntries(judgedGoals(level).map(item => [item.id, item.expect]));
}

export function startGame(solved = false, level = defaultLevel) {
  // A candidate level's reference build is one of its schemes, so only the
  // resistors that scheme uses may be on the board — an unused one would look
  // like a dangling branch.
  const referenceCandidate = (level.circuit?.candidates || []).find(candidate =>
    candidate.wires.length === (level.circuit.solutionWires || []).length &&
    candidate.wires.every(wire => level.circuit.solutionWires.includes(wire))) || null;
  const candidateResistorIds = new Set(Object.keys(referenceCandidate?.values || {}));
  return {
    levelId: level.id,
    placed: Object.fromEntries([
      ...level.parts.filter(part => !['wire', 'probe'].includes(part.id) && !(part.id === 'resistor' && part.count === '∞')).map(part => [part.id, solved || Boolean(level.board.fixedParts?.includes(part.id))]),
      ...(level.circuit.resistors || []).map(id => [id, Boolean(level.board.fixedParts?.includes(id)) ||
        (solved && (!referenceCandidate || candidateResistorIds.has(id)))]),
    ]),
    wires: solved ? [...level.circuit.solutionWires] : [...(level.circuit.initialWires || [])],
    reversed: solved ? false : level.initialReversed,
    resistorOhms: level.electrical.resistorOhms,
    resistorValues: level.model === 'resistor-dc-v1'
      ? Object.fromEntries(level.circuit.resistors.map(id => [id, solved ? level.electrical.referenceOhms[id] : level.electrical.defaultOhms[id]]))
      : {},
    positions: structuredClone(level.board.positions),
    // Player's absorbed/delivered power judgement, per element id.
    powerJudging: solved ? judgedAnswers(level) : {},
    // Player-chosen rated power per resistor; missing means the level default.
    resistorRatings: {},
    // A tunable transconductance starts at the level's default, never at the
    // reference value that solves the level.
    // The reference build of a candidate level is one of its schemes, so name it.
    ...(level.circuit?.candidates ? {
      candidateId: solved ? (referenceCandidate?.id ?? null) : null,
    } : {}),
    ...(level.circuit?.controlledSource ? {
      controlledGmMs: solved
        ? level.electrical.controlledTransconductanceMs
        : (level.electrical.defaultTransconductanceMs ?? level.electrical.controlledTransconductanceMs),
    } : {}),
  };
}

const modelRegistry = { 'gpio-led-series-v1': evaluateGpioLedSeries, 'resistor-dc-v1': evaluateResistorDc };

export function evaluateCircuit(game, level = defaultLevel, probe = null) {
  const model = modelRegistry[level.model];
  if (!model) throw new Error('Unsupported circuit model: ' + level.model);
  if (game.levelId && game.levelId !== level.id) throw new Error('Game state belongs to a different level');
  const report = model(game, level, probe);
  return { ...report, componentStates: resolveComponentStates(game, level, report) };
}

function resistorCurrentText(network, ids) {
  return (ids || [])
    .filter(id => Number.isFinite(network.resistorResults[id]?.currentMa))
    .map(id => id.toUpperCase() + ' ' + network.resistorResults[id].currentMa.toFixed(2) + ' mA')
    .join('、');
}

function evaluateResistorDc(game, level, probe) {
  const network = solveResistiveNetwork(game, level);
  // A current-source level fixes the branch current and lets the node voltage
  // follow the connected network; a voltage-source level does the opposite.
  const currentSource = Boolean(level.circuit.currentSource);
  const controlledSource = Boolean(level.circuit.controlledSource);
  const dualSource = Boolean(level.circuit.source && level.circuit.currentSource);
  const sourceLabel = currentSource ? level.electrical.sourceCurrentMa.toFixed(2) + ' mA 电流源' : level.electrical.sourceV.toFixed(1) + ' V 电源';
  const rated = level.electrical.resistorRatedPowerW;
  // A level may ask the player to judge absorbed vs delivered power. The signed
  // element powers already carry the truth; the goal rule compares it with what
  // the player chose, and the feedback below names the elements that disagree.
  const powerJudgement = Boolean(level.circuit.powerJudgement);
  const judged = judgedGoals(level);
  const elementLabel = id => id === level.circuit.source ? '电源'
    : id === level.circuit.currentSource?.id ? '电流源' : id.toUpperCase();
  const absorbedText = id => {
    const powerMw = network.elementPowerMw?.[id];
    return Number.isFinite(powerMw)
      ? elementLabel(id) + (powerMw >= 0 ? ' 吸收 ' : ' 释放 ') + Math.abs(powerMw).toFixed(2) + ' mW'
      : elementLabel(id) + ' 未求解';
  };
  const powerLine = judged.map(item => absorbedText(item.id)).join('、');
  // Power magnitudes only: the direction is exactly what the player must decide,
  // so failure feedback must not spell it out.
  const powerMagnitudes = judged.map(item => {
    const powerMw = network.elementPowerMw?.[item.id];
    return Number.isFinite(powerMw) ? elementLabel(item.id) + ' ' + Math.abs(powerMw).toFixed(2) + ' mW' : elementLabel(item.id) + ' 未求解';
  }).join('、');
  const resistorResults = Object.values(network.resistorResults);
  const placedResistorIds = Object.keys(game.placed).filter(id => game.placed[id] && /^r\d+$/.test(id));
  const networkSafe = !network.shorted && !network.currentSourceShorted && !network.unresolved && network.allSelected &&
    resistorResults.every(item => Number.isFinite(item.currentMa) && item.currentMa > 1e-6 && item.powerW <= rated) &&
    Number.isFinite(network.totalCurrentMa) && network.kclErrorMa < 0.01;
  const metrics = { ...network, networkSafe };
  const checks = evaluateGoals(level, game, null, normalizeWire, probe, metrics);
  const success = checks.every(Boolean);
  const flowEdges = Object.values(network.wireCurrents).map(item => [item.from, item.to]);
  const currentLabel = Number.isFinite(network.totalCurrentMa)
    ? '约 ' + network.totalCurrentMa.toFixed(2) + ' mA' : '未计算';
  const currentPath = { kind: 'resistor-network', currentMa: network.totalCurrentMa,
    currentLabel, flowLabel: level.circuit.flowLabel || '直流电阻网络' };
  // Parallel branches are whatever actually leaves node A towards GND, so a
  // resistor in series with the source is reported separately instead of being
  // mistaken for a branch.
  const measuredBranches = resistorCurrentText(network, network.branchIds);
  const seriesElements = resistorCurrentText(network, network.sourceSeriesIds);
  const seriesNote = seriesElements
    ? '电流源没有直接接到节点 A：' + seriesElements + ' 串在两者之间。理想电流源串联电阻不改变电流，只抬高源端电压；对偶地，理想电压源并联电阻不改变电压。'
    : null;
  // With two sources on one node, a current source wired the other way round
  // sinks instead of sources; it is a wrong answer, not a fault, so it is
  // explained as a note instead of changing the verdict.
  // Two ways to get the current source wrong on a dual-source level: not wiring
  // it onto the measured node at all (it then only loads the voltage source), or
  // wiring it the other way round (it sinks instead of injecting).
  const offNodeNote = dualSource && !network.unresolved && !network.currentSourceTouchesNodeA &&
    Number.isFinite(network.currentSourceVoltageV)
    ? '电流源的两端都不在节点 A 的网络上：它现在只把 ' + level.electrical.sourceCurrentMa + ' mA 从电压源那一路送回 GND，节点 A 里没有这 ' + level.electrical.sourceCurrentMa + ' mA。把流出端接到节点 A、流回端接到 GND。'
    : null;
  const reversedNote = dualSource && level.circuit.currentSourcePolarity !== 'either' && network.currentSourceTouchesNodeA &&
    Number.isFinite(network.currentSourceVoltageV) && network.currentSourceVoltageV < -0.05
    ? '电流源此刻在从节点 A 抽走 ' + level.electrical.sourceCurrentMa + ' mA（端电压为负），方向与本关要求的“向节点 A 注入”相反。'
    : null;
  const teachingNote = [seriesNote, offNodeNote, reversedNote].filter(Boolean).join(' ') || null;
  const controlPoint = level.circuit.controlledSource?.control?.positive === 'nodeB' ? '节点 B' : '节点 A';
  const controlledReadings = '节点 A 约 ' + (Number.isFinite(network.nodeAV) ? network.nodeAV.toFixed(2) + ' V' : '未求解')
    + '、' + controlPoint + '（控制量）约 ' + (Number.isFinite(network.controlledSourceControlV) ? network.controlledSourceControlV.toFixed(2) + ' V' : '未求解')
    + '、受控源输出 ' + (Number.isFinite(network.controlledSourceCurrentMa) ? network.controlledSourceCurrentMa.toFixed(2) + ' mA' : '不输出（控制量或回路未建立）')
    + '（当前 g = ' + Number(network.controlledTransconductanceMs ?? 0).toFixed(2) + ' mS）';
  const dualReadings = '电压源输出 ' + (Number.isFinite(network.voltageSourceCurrentMa)
    ? network.voltageSourceCurrentMa.toFixed(2) + ' mA' : '未求解')
    + '、节点 A 经支路流出 ' + (Number.isFinite(network.branchTotalCurrentMa)
      ? network.branchTotalCurrentMa.toFixed(2) + ' mA' : '未求解')
    + '、电流源端电压 ' + (Number.isFinite(network.currentSourceVoltageV)
      ? network.currentSourceVoltageV.toFixed(2) + ' V' : '未求解');
  // Fault verdicts below keep `success` false: an overloaded or shorted circuit
  // must never clear the level even when its readings happen to match.
  const base = { checks, success: false, currentLabel, currentPath, flowEdges,
    network, ledState: 'off', gpioWaveform: 'flat', note: teachingNote };
  const result = (kind, headline, observed, explanation, nextStep) => ({
    ...base, kind, headline, observed, explanation, nextStep, message: headline,
  });
  // A fault means the build is not a valid answer yet, so no goal may be
  // credited: the checklist can never read "2 / 2" while 检查电路 rejects the
  // circuit. A plain wrong value (target-mismatch) keeps its real checklist,
  // because that is the case where the ticks tell the player what is missing.
  const fault = (kind, headline, observed, explanation, nextStep) => ({
    ...result(kind, headline, observed, explanation, nextStep),
    checks: checks.map(() => false),
    success: false,
  });
  if (network.shorted) return fault('supply-short', '电源正负端被导线短接',
    '电源输出已停止求解，节点电压与电流不能可靠显示。',
    '导线形成了绕过电阻的零电阻通路。真实短路电流取决于电源内阻与保护电路。',
    '检查电源与 GND 之间的直连导线。');
  if (network.currentSourceShorted) return fault('current-source-short', '电流源两端被导线短接',
    '电流源的两个端子接到同一个节点上，本关模型停止求解。',
    '理想电流源强制输出 ' + level.electrical.sourceCurrentMa + ' mA，两端短接时它的电压不受约束；实际电源会进入限流或保护状态。',
    '检查电流源的两个端子是否都接到了节点 A：流出端应经支路回到 GND，再回到流回端。');
  if (level.circuit.candidates && !game.candidateId && !game.wires.length) return fault('missing-part', '先选择一个候选方案',
    '画布上只有电源、节点 A、GND 和负载，串联部分还没有接。',
    '这一关的电路由候选方案决定，不能自己拖电阻或接线：每个方案给出不同的串联器件组合，读数与器件应力会不同。',
    '在左侧「候选方案」里选一个，再对照右侧读数与 检查电路 的结果。');
  if (placedResistorIds.length === 0) return fault('missing-part', '先放入电阻',
    '画布上还没有电阻，电路无法导通。',
    controlledSource
      ? '本关要求两件事：让节点 A 达到目标电压，并让受控源的输出电流达到目标——它的输出由控制量决定，不能直接设定。'
      : powerJudgement
      ? '本关要求两件事：让节点 A 达到目标电压，并判断每个元件在吸收还是释放功率。'
      : currentSource
        ? '本关只要求一个结果：让电流源输出的 ' + level.electrical.sourceCurrentMa + ' mA 分成两条并联支路，怎么接由你决定。'
        : '本关只要求一个结果：让节点 A 约 4.5 V、总电流约 4.5 mA，怎么搭由你决定。',
    '从元件库拖电阻到搭建区，搭出你想到的网络。');
  if (!network.allSelected) return fault('resistor-unselected', '还有电阻未选阻值',
    '未定阻值的支路不能求解。', level.concept,
    '逐只点击画布上的电阻，选择阻值。');
  if (network.unresolved) {
    // An open current source simply carries no current. With a voltage source in
    // the same network the rest of the circuit is still solved, so say what the
    // node actually reads instead of claiming there is no reading at all.
    const observed = level.circuit.source
      ? '电流源这一支路没有闭合，它因此不输出电流；节点 A 由电压源决定，当前为 '
        + (Number.isFinite(network.nodeAV) ? network.nodeAV.toFixed(2) + ' V' : '未求解') + '。'
      : '电流源两端没有经过电阻网络回到 GND，节点电压没有参考点，本关模型不给出读数。';
    return fault('open-circuit', '电流源还没有形成闭合回路', observed,
      '电流必须从电流源的流出端经外电路回到流回端。悬空节点不会被当作 0 V。',
      '沿 电流源 → 节点 A → 支路 → GND → 电流源 检查未连接的端点。');
  }
  if (currentSource && level.circuit.currentSourcePolarity !== 'either' &&
      Number.isFinite(network.nodeAV) && network.nodeAV < -0.05) {
    return fault('reversed-source', '电流源方向接反了',
      '节点 A 出现负电压 ' + network.nodeAV.toFixed(2) + ' V，各支路电流方向相反。',
      '电流实际是从电流源的流回端流出、经节点 A 回到流出端，与参考方向相反。',
      '把电流源流出端接到节点 A、流回端接到 GND；交换这两条导线即可。');
  }
  if (!Number.isFinite(network.nodeAV) || !Number.isFinite(network.totalCurrentMa) ||
      placedResistorIds.some(id => {
        const part = network.resistorResults[id];
        return !part || !Number.isFinite(part.currentMa) || (!part.connected && !part.bypassed);
      })) {
    return fault('open-circuit', '网络尚未形成目标回路',
      '至少一条支路没有可计算的闭合电流。',
      currentSource
        ? '电流必须从电流源流出端经节点 A 分配到各条并联支路，再回到 GND。悬空节点不会被当作 0 V。'
        : '电流必须从电源经 R1 到达节点 A，再经 R2 返回 GND。悬空节点不会被当作 0 V。',
      currentSource
        ? '沿 电流源 → 节点 A → 各支路 → GND 检查各端点。'
        : '沿电源 → R1 → 节点 A → R2 → GND 检查各端点。');
  }
  const bypassed = placedResistorIds.find(id => network.resistorResults[id]?.bypassed);
  if (bypassed) {
    const label = bypassed.toUpperCase();
    return fault('resistor-short', label + ' 被导线短接',
      label + ' 两端电位相同、电流约为 0 mA，其余支路仍导通。',
      '电阻两端被一根导线直接连通时，电流绕过该电阻，其两端电压差为零。',
      '检查并删除绕过 ' + label + ' 的多余导线，让电流从该电阻流过。');
  }
  const overloaded = Object.entries(network.resistorResults).filter(([, item]) => item.powerW > item.ratedPowerW);
  if (overloaded.length) {
    const detail = overloaded
      .map(([id, item]) => id.toUpperCase() + ' ' + (item.powerW * 1000).toFixed(0) + ' mW / ' + (item.ratedPowerW * 1000).toFixed(0) + ' mW')
      .join('、');
    return fault('resistor-overload', '电阻功率超过它自己的额定值',
      detail + '（实际 / 额定）。',
      '额定功率是每只器件的硬约束：算 P = I²R 再和它自己的额定值比较。超限时有两类解法——换一只额定功率更大的器件（例如把 ¼ W 换成 ½ W），或者把这条支路拆成 n 只等值电阻并联：等效阻值不变，每只只承担 1/n 的电流，功率降到 1/n。',
      '点开过载的电阻，可以改它的阻值或额定功率档位；也可以再加一只电阻并起来分流。');
  }
  if (success) {
    if (level.circuit.load) {
      const parts = Object.entries(game.resistorValues || {})
        .filter(([id]) => /^r\d+$/.test(id) && game.placed[id] && id !== level.circuit.load)
        .map(([id, ohms]) => id.toUpperCase() + ' ' + ohms + ' Ω / ' + ((network.resistorResults[id]?.ratedPowerW ?? rated) * 1000).toFixed(0) + ' mW')
        .join('、');
      return { ...result('success', '读数达标，器件也都在额定值以内',
        '节点 A（负载电压）' + network.nodeAV.toFixed(2) + ' V、负载功率 ' + (network.r2PowerMw ?? 0).toFixed(1)
          + ' mW；串联部分 ' + (parts || '已接好') + '。',
        '你的解法同时满足两件事：功能读数达标（9 V 落在串联部分、30 mA 流过负载），每只器件的耗散也没超过它自己的额定功率。'
          + '一只 300 Ω 会让 30 mA 全流过它、耗散 270 mW；拆成两只 600 Ω 并联后每只只有 135 mW，换成一只 ½ W 器件则是另一种解法。',
        '再试试另一种思路：把同一只 300 Ω 的额定功率从 ¼ W 换成 ½ W，读数不变而应力问题也解决了——比较一下件数、裕量和成本。'), success: true };
    }
    if (powerJudgement) {
      return { ...result('success', '工作点与功率判断都正确',
        '节点 A 约 ' + network.nodeAV.toFixed(2) + ' V；' + powerLine + '。',
        '功率要按参考方向判断：电压与电流为关联参考方向时 P = U·I，非关联时 P = −U·I；P > 0 吸收、P < 0 释放。本例里电源与电流源的箭头都从标 + 的端子流出，所以用 P = −U·I：电流源的端电压与它的电流方向相反，这个「源」其实在吸收功率（被外电路充电）。整个电路 ΣP吸收 = ΣP释放。',
        '换一组 R1、R2 再试：观察电流源的功率什么时候由吸收变成释放，以及节点 A 跟着怎么变。'), success: true };
    }
    if (controlledSource) {
      return { ...result('success', '受控源工作点符合目标',
        '节点 A 约 ' + network.nodeAV.toFixed(2) + ' V；受控源输出 ' + network.controlledSourceCurrentMa.toFixed(2)
          + ' mA（g·U控制 = ' + level.electrical.controlledTransconductanceMs + ' mS × ' + network.controlledSourceControlV.toFixed(2) + ' V）。',
        '受控源的输出不是常数，而是控制量的函数：U_A 变了它就跟着变。把它代进 KCL：(9 V − U_A)/R1 + g·U_A = U_A/R2，本关 2.25 mA + 2.25 mA = 4.5 mA 正好对得上。控制量为 0 时它什么都不输出——受控源不能独立激励电路。',
        '把 R1 改大一倍，先预测受控源输出会变大还是变小，再看探针读数。'), success: true };
    }
    if (dualSource) {
      return { ...result('success', '双源共同作用的结果符合目标',
        '节点 A 约 ' + network.nodeAV.toFixed(2) + ' V；' + dualReadings + '。',
        '电压源管住它两端的 ' + level.electrical.sourceV.toFixed(1) + ' V、电流源管住 ' + level.electrical.sourceCurrentMa.toFixed(1) + ' mA，两者的“另一个量”都由你接的外电路决定。KCL：电压源送来的 3.00 mA + 电流源注入的 3.00 mA = 节点 A 流出的 6.00 mA。',
        '试着只留一个源（另一个先不接），看节点 A 变成多少：两个单独作用的结果相加，正好等于现在的读数。'), success: true };
    }
    return currentSource
      ? { ...result('success', '分流结果符合目标',
        '节点 A 约 ' + network.nodeAV.toFixed(2) + ' V；' + sourceLabel + '被分成 ' + (measuredBranches || '两条并联支路') + '。',
        '理想电流源的电流恒定，节点电压由外电路决定：U = I × R等效。并联支路按电导分配电流，电阻小的支路分到更多电流。',
        '换一组阻值再试：改变任一支路，观察节点电压如何变化、源电流如何保持不变。'), success: true }
      : { ...result('success', '节点电压与总电流都符合目标',
        '节点 A 约 ' + network.nodeAV.toFixed(2) + ' V；总电流约 ' + network.totalCurrentMa.toFixed(2) + ' mA。',
        '这就是你的解法：流入节点 A 的电流等于流出的电流；沿任一回路，各段电压降之和等于电源 9 V。',
        '换一种结构再试一次：串联分压、多支路并联，都能达到同样的节点电压。'), success: true };
  }
  if (powerJudgement) {
    const pending = judged.filter(item => !game.powerJudging?.[item.id]).length;
    const mismatched = judged.filter(item => {
      const powerMw = network.elementPowerMw?.[item.id];
      const answer = game.powerJudging?.[item.id];
      return answer && Number.isFinite(powerMw) && answer !== (powerMw >= 0 ? 'absorb' : 'deliver');
    }).length;
    return result('target-mismatch', '工作点或功率判断还没达标',
      '节点 A 为 ' + (Number.isFinite(network.nodeAV) ? network.nodeAV.toFixed(2) + ' V' : '未求解')
        + '；各元件功率大小为 ' + powerMagnitudes + '（方向要你自己判断）。',
      '按参考方向算功率：电压与电流为关联参考方向时 P = U·I，非关联时 P = −U·I；P > 0 吸收、P < 0 释放。电阻永远只吸收，电源和电流源要看它们端电压与电流方向的配合。',
      pending
        ? '还有 ' + pending + ' 个元件没有判断：点开该元件的参数菜单，选择吸收或释放。'
        : mismatched
          ? '有 ' + mismatched + ' 个元件的判断与它的电压、电流符号不符，逐个重新核对。'
          : '先核对节点 A 的电压：KCL 对不上时，先看电流源是往节点 A 送电流还是从它抽走电流。');
  }
  if (controlledSource) {
    const inactive = !Number.isFinite(network.controlledSourceCurrentMa);
    return result('target-mismatch', inactive ? '受控源还没有工作' : '电路导通，但受控源工作点未达到目标',
      inactive
        ? '受控源这一支路没有闭合，或它的控制量取不到：它因此不输出电流。'
        : controlledReadings + '，电压源输出 ' + (Number.isFinite(network.voltageSourceCurrentMa) ? network.voltageSourceCurrentMa.toFixed(2) + ' mA' : '未求解') + '。',
      inactive
        ? '受控源不能独立激励电路：它的输出是 g·U控制，控制量为 0 就没有输出。先把它的流出端接到节点 A、流回端接到 GND，并让节点 A 有确定电压。'
        : '受控源的输出跟着 U_A 走，所以 KCL 里要把它写成 g·U_A：(9 V − U_A)/R1 + g·U_A = U_A/R2，把含 U_A 的项移到同一边再解。' + level.concept,
      inactive
        ? '沿 电源 → R1 → 节点 A → 受控源 → GND 检查断开的端点。'
        : '先只接 9 V 电源和 R1、R2、R3，看节点 B 被分到多少；再接上受控源，看它把节点 A 抬到多少——两者之差就是它的贡献。接法与阻值都对时，剩下能改的就是受控源的跨导 g：点开受控源把滑块调到参考值（见「查看答案」里的「跨导 g」）。');
  }
  if (dualSource) {
    return result('target-mismatch', '电路导通，但双源工作点未达到目标',
      '节点 A 为 ' + network.nodeAV.toFixed(2) + ' V；' + dualReadings + '。',
      '两个源同时作用时用 KCL 联立：流入节点 A 的电流（电压源经 R1 的电流 + 电流源的 ' + level.electrical.sourceCurrentMa.toFixed(1) + ' mA）等于流出节点 A 的电流。' + level.concept,
      '先只接电压源看 A 被抬到多少，再接上电流源看 A 被拉到哪里，然后回到联立关系调整 R1、R2。');
  }
  return currentSource
    ? result('target-mismatch', '电路导通，但分流结果未达到目标',
      '节点 A 为 ' + network.nodeAV.toFixed(2) + ' V，节点 A 到 GND 的并联支路为 ' + (measuredBranches || '尚未形成') + '。',
      '节点电压由并联等效电阻决定：U = I × (R1∥R2)；支路电流按电导分配。' + level.concept,
      '先预测把哪只电阻改小会让它分到更多电流，再用探针核对。')
    : result('target-mismatch', '电路导通，但测量值未达到目标',
      '节点 A 为 ' + network.nodeAV.toFixed(2) + ' V，总电流为 ' + network.totalCurrentMa.toFixed(2) + ' mA。',
      '检查串联电阻与两个并联支路的阻值。' + level.concept,
      '先预测改变哪只电阻会使节点电压接近 4.5 V，再用探针核对。');
}

function evaluateGpioLedSeries(game, level, probe) {
  const c = level.circuit;
  const e = electricalFor(game, level);
  const expectedCurrentMa = estimateSeriesCurrentMa(e);
  const has = (a, b) => game.wires.some(wire => normalizeWire(wire) === wireKey(a, b));
  const supply = Boolean(game.placed.mcu && game.placed.power && game.placed.ground && c.baseWires.every(wire => game.wires.some(item => normalizeWire(item) === normalizeWire(wire))));
  const resistorChain = Boolean(game.placed.mcu && game.placed.resistor && game.placed.led && has(c.gpio, c.resistor[0]) && has(c.resistor[1], c.led[0]));
  const ledReturn = Boolean(game.placed.led && game.placed.ground && has(c.led[1], c.ground));
  const noExtraWires = game.wires.every(wire => c.solutionWires.some(expected => normalizeWire(expected) === normalizeWire(wire)));
  const currentPath = detectCurrentPath(game, supply, level);
  const checks = evaluateGoals(level, game, currentPath, normalizeWire, probe);
  const success = checks.every(Boolean);
  const base = {
    checks, success: false, ledState: currentPath?.kind === 'led-series' ? 'on' : 'off',
    currentLabel: currentPath?.currentLabel || '0 mA', currentPath,
    flowEdges: currentPath?.flowEdges || [], gpioWaveform: supply ? 'step' : 'idle',
  };
  const result = (kind, headline, observed, explanation, nextStep, extra = {}) => ({
    ...base, kind, headline, observed, explanation, nextStep, message: headline, ...extra,
  });
  const voltage = e.gpioHighV.toFixed(1);
  const ledDrop = e.ledForwardV.toFixed(1);
  const current = expectedCurrentMa?.toFixed(1);
  const resistorLabel = e.resistorOhms ? e.resistorOhms + ' Ω 电阻' : '限流电阻';

  if (wirePath(game, c.supply, c.ground)) {
    return result(
      'supply-short', '电源被直接短接', '仿真停止；LED 未点亮，电流读数不可靠。',
      voltage + ' V 电源正极直接接地。该接法可能使电源或导线过流，本关停止正常输出计算。',
      '删除电源与 GND 间的短接线，再检查 VDD 和 GND。',
      { ledState: 'off', currentLabel: '未计算', gpioWaveform: 'unknown', currentPath: null, flowEdges: [] },
    );
  }
  if (supply && wirePath(game, c.gpio, c.ground)) {
    return result(
      'gpio-short', 'GPIO0 输出短路', 'GPIO0 被拉向地，LED 未正常点亮。',
      'GPIO0 输出高电平时直接连到 GND，可能使 MCU 引脚过流。实际电流与损坏情况取决于器件规格。',
      '删除 GPIO0 到 GND 的直连线，让电流经过限流电阻与 LED。',
      { currentLabel: '未计算', gpioWaveform: 'unknown', currentPath: null, flowEdges: [] },
    );
  }
  const directFromGpio = supply && Boolean(wirePath(game, c.gpio, c.led[0])?.length);
  const directFromPower = game.placed.power && Boolean(wirePath(game, c.supply, c.led[0])?.length);
  const directLedPath = game.placed.led && Boolean(wirePath(game, c.led[1], c.ground)?.length) && (directFromGpio || directFromPower);
  if (directLedPath && game.reversed) {
    return result(
      'reversed', 'LED 方向接反了', '本关模型中 LED 不导通，支路电流约为 0 mA。',
      'LED 的正负极与预期电流方向相反，因此不会按目标点亮。', '选中 LED 并点击「翻转 LED」。',
    );
  }
  if (directLedPath) {
    return result(
      'overcurrent', 'LED 过流失效', '教学演示中，LED 短暂闪亮后熄灭；支路电流不能可靠给出。',
      (directFromGpio ? 'GPIO0' : voltage + ' V 电源') + '直接连接 LED，' + resistorLabel + '未串入支路。此时不能把电阻视为 0 Ω 代入公式，也无法保证电流低于本关的 ' + e.warningCurrentMa + ' mA 比较线。',
      '把' + resistorLabel + '串在 GPIO0 与 LED 之间，再重新连接支路。',
      { ledState: 'burned', currentLabel: '过流风险', currentPath: null, flowEdges: [],
        gpioWaveform: directFromGpio ? 'unknown' : supply ? 'step' : 'idle',
        note: '这里用 LED 失效演示过流风险；真实硬件可能出现 GPIO 限流或掉压、LED 或 MCU 损坏，结果需依据具体器件数据手册。' },
    );
  }
  if (currentPath?.resistorPowerW > e.resistorRatedPowerW) {
    const powerW = currentPath.resistorPowerW;
    return result(
      'resistor-overload', '电阻耗散功率超过额定值',
      '教学演示中电阻爆裂并使支路断开；失效前估算电流为 ' + currentPath.currentLabel + '。',
      '按 P = I²R 估算，电阻耗散约 ' + powerW.toFixed(3) + ' W，超过本关设定的 ' + e.resistorRatedPowerW.toFixed(3) + ' W 额定功率。实际器件可能发热、变色或开路，不一定爆裂。',
      '增大电阻阻值以降低电流与耗散功率，再检查支路。',
      { ledState: 'off', currentLabel: '未计算', currentPath: null, flowEdges: [],
        resistorFailure: { powerW, currentMa: currentPath.currentMa },
        note: '爆裂是教学视觉效果；实际失效形式取决于电阻结构、额定功率和散热条件。' },
    );
  }
  const requiredParts = [...new Set([c.supply, c.ground, c.mcuVdd, c.mcuGround, c.gpio, ...c.resistor, ...c.led].map(endpoint => endpoint.split('.')[0]))];
  const missing = requiredParts.filter(id => !game.placed[id]);
  if (missing.length) {
    const labels = Object.fromEntries(level.parts.map(part => [part.id, part.id === 'resistor' ? resistorLabel : part.label]));
    return result(
      'missing-part', '元件还没有放齐',
      currentPath ? 'LED 未点亮；但电阻支路已有约 ' + currentPath.currentMa.toFixed(1) + ' mA 电流。' : 'LED 未点亮；当前没有完整的 LED 支路。',
      '本关需要 ' + requiredParts.map(id => labels[id]).join('、') + '。' + (currentPath ? currentPath.detail : '当前没有已识别的闭合支路，电流为 0 mA。'),
      '从元件库拖入 ' + missing.map(id => labels[id]).join('、') + '，再完成接线。',
    );
  }
  if (!supply) {
    return result(
      'unpowered', 'MCU 尚未正常上电', 'GPIO0 没有有效输出，LED 不亮。',
      'MCU 的 VDD 或 GND 连接缺失，无法形成可靠的供电回路。', '先将电源接至 VDD，并将 MCU 的 GND 接地。',
    );
  }
  if (level.electrical.resistorOptionsOhms && !e.resistorOhms) {
    return result(
      'resistor-unselected', '还未选择电阻阻值', '阻值未确定，支路电流暂不能计算。',
      level.concept, '点选元件库中的限流电阻，选好阻值，再拖入搭建区。',
      { currentLabel: '未计算' },
    );
  }
  if (resistorChain && ledReturn && game.reversed) {
    return result(
      'reversed', 'LED 方向接反了', '本关模型中 LED 不导通，支路电流约为 0 mA。',
      '虽然电阻已串入，但 LED 极性与电流方向相反。', '选中 LED 并点击「翻转 LED」。',
    );
  }
  if (success) {
    return {
      ...base, success: true, kind: 'success', ledState: 'on', currentLabel: '约 ' + current + ' mA', gpioWaveform: 'step',
      headline: '电路通过本关验证，LED 已点亮。', observed: 'GPIO0 高电平约 ' + voltage + ' V，LED 支路电流约 ' + current + ' mA。',
      explanation: '本关假设 LED 正向压降约 ' + ledDrop + ' V。按欧姆定律，I = (' + voltage + ' − ' + ledDrop + ') V ÷ ' + e.resistorOhms + ' Ω ≈ ' + current + ' mA，低于本关 ' + e.warningCurrentMa + ' mA 比较线。',
      nextStep: '换一个阻值，或移动探针继续探索电路。', message: '电路通过本关验证，LED 已点亮。',
    };
  }
  if (currentPath?.kind === 'led-series' && noExtraWires &&
      ((e.minimumCurrentMa !== null && currentPath.currentMa < e.minimumCurrentMa) || currentPath.currentMa >= e.warningCurrentMa)) {
    return result(
      'current-out-of-range', '支路电流还不在目标范围',
      'LED 已点亮，当前估算电流为 ' + currentPath.currentLabel + '。',
      (e.minimumCurrentMa === null ? '本关把 ' + e.warningCurrentMa + ' mA 作为比较线。' : '目标是达到 ' + e.minimumCurrentMa + ' mA 且低于 ' + e.warningCurrentMa + ' mA。') + level.concept,
      '调整电阻阻值，实时观察电流，再检查电路。',
    );
  }
  if (currentPath?.kind === 'led-series' && noExtraWires && level.measurement) {
    return result(
      'measurement-needed', '还差一次探针测量',
      'LED 已点亮，支路电流约 ' + current + ' mA。',
      '本关还需要把探针移到指定节点，读取对应的电压和支路电流。',
      '拖入探针，拖动手柄或点击「测量」后选择 ' + level.measurement.target + '。',
    );
  }
  if (!noExtraWires) {
    return result(
      'miswire', '检测到异常连线',
      currentPath ? currentPath.detail + ' 但当前接法尚未达到点灯目标。' : '教学模型无法把当前接法判为安全点灯电路。',
      '电路中存在目标支路以外的连接；实际后果要先确认具体短接点与元件额定值。',
      '选中多余导线并删除，再按 GPIO0 → 电阻 → LED → GND 检查。',
      currentPath ? {} : { currentLabel: '未计算' },
    );
  }
  return result(
    'open-circuit', 'LED 支路没有闭合', 'LED 不亮，支路电流为 0 mA。',
    '缺少一段必要连接，电流无法从 GPIO0 经过电阻和 LED 回到 GND，因此当前是 0 mA。' + (level.electrical.resistorOptionsOhms ? '请先选阻值并完成接线，再观察实时电流。' : '接通目标支路后预计约 ' + current + ' mA。'),
    '沿 GPIO0 → 电阻 → LED → GND 逐段检查未连接的端点。',
  );
}
