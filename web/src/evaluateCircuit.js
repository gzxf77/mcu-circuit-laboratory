// Shared runtime for the GPIO → resistor → LED circuit family. The app passes a
// level definition; this file contains no level numbers or fixed component values.
import { detectCurrentPath, wirePath } from './currentPaths.js';
import { resolveComponentStates } from './componentStates.js';
import { evaluateGoals } from './engine/goalRules.js';
import { electricalFor, estimateSeriesCurrentMa } from './levelElectrical.js';
import { defaultLevel } from './levels/catalog.js';
import { solveResistiveNetwork } from './resistiveNetwork.js';

export const wireKey = (a, b) => [a, b].sort().join('-');
export const normalizeWire = wire => wireKey(...wire.split('-'));
// Shared wiring aliases for the introductory GPIO → LED family.
export const baseWires = defaultLevel.circuit.baseWires || [];
export const solutionWires = defaultLevel.circuit.solutionWires;

export function startGame(solved = false, level = defaultLevel) {
  // Diagnosis levels look fully wired but hide one random fault: either an open
  // wire (electrically removed) or a short (a hidden wire bypassing a resistor).
  const openCandidates = level.circuit.hiddenOpenCandidates?.length
    ? level.circuit.hiddenOpenCandidates
    : (level.circuit.hiddenOpenWires || []);
  const shortCandidates = level.circuit.hiddenShortCandidates || [];
  const faultPool = [
    ...openCandidates.map(target => ({ kind: 'open', target })),
    ...shortCandidates.map(target => ({ kind: 'short', target })),
  ];
  const diagnosing = faultPool.length > 0;
  const fault = !diagnosing ? null
    : solved ? faultPool[0]
      : faultPool[Math.floor(Math.random() * faultPool.length)];
  const hiddenOpenWire = fault?.kind === 'open' ? fault.target : null;
  const hiddenShortId = fault?.kind === 'short' ? fault.target : null;
  const hiddenShortWire = hiddenShortId ? hiddenShortId + '.a-' + hiddenShortId + '.b' : null;
  const hiddenOpenSet = hiddenOpenWire ? new Set([normalizeWire(hiddenOpenWire)]) : new Set();
  let startWires;
  if (solved && !diagnosing) startWires = [...level.circuit.solutionWires];
  else if (diagnosing) {
    startWires = level.circuit.solutionWires.filter(wire => !hiddenOpenSet.has(normalizeWire(wire)));
    if (hiddenShortWire) startWires = [...startWires, hiddenShortWire];
  } else startWires = [...(level.circuit.initialWires || [])];
  return {
    levelId: level.id,
    placed: Object.fromEntries([
      ...level.parts.filter(part => !['wire', 'probe'].includes(part.id) && !(part.id === 'resistor' && part.count === '∞')).map(part => [part.id, solved || Boolean(level.board.fixedParts?.includes(part.id))]),
      ...(level.circuit.resistors || []).map(id => [id, solved || Boolean(level.board.fixedParts?.includes(id))]),
    ]),
    wires: startWires,
    // Visual wires: both faults look like a fully wired healthy circuit (the open
    // is still drawn, and the short wire is never drawn).
    visualWires: diagnosing ? [...level.circuit.solutionWires] : null,
    faultKind: fault?.kind ?? null,
    hiddenOpenWire,
    hiddenShortId,
    hiddenShortWire,
    suspectedWires: solved && hiddenOpenWire ? [hiddenOpenWire] : [],
    suspectedShort: solved && hiddenShortId ? hiddenShortId : null,
    reversed: solved ? false : level.initialReversed,
    resistorOhms: level.electrical.resistorOhms,
    resistorValues: level.model === 'resistor-dc-v1'
      ? Object.fromEntries(level.circuit.resistors.map(id => [id, solved ? level.electrical.referenceOhms[id] : level.electrical.defaultOhms[id]]))
      : {},
    positions: structuredClone(level.board.positions),
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

function evaluateResistorDc(game, level, probe) {
  const network = solveResistiveNetwork(game, level);
  if (level.circuit.hiddenOpenCandidates?.length || level.circuit.hiddenOpenWires?.length || level.circuit.hiddenShortCandidates?.length) return evaluateFaultDiagnosis(game, level, network);
  const rated = level.electrical.resistorRatedPowerW;
  const resistorResults = Object.values(network.resistorResults);
  const placedResistorIds = Object.keys(game.placed).filter(id => game.placed[id] && /^r\d+$/.test(id));
  const networkSafe = !network.shorted && network.allSelected &&
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
  const base = { checks, success, currentLabel, currentPath, flowEdges,
    network, ledState: 'off', gpioWaveform: 'flat' };
  const result = (kind, headline, observed, explanation, nextStep) => ({
    ...base, kind, headline, observed, explanation, nextStep, message: headline,
  });
  if (network.shorted) return result('supply-short', '电源正负端被导线短接',
    '电源输出已停止求解，节点电压与电流不能可靠显示。',
    '导线形成了绕过电阻的零电阻通路。真实短路电流取决于电源内阻与保护电路。',
    '检查电源与 GND 之间的直连导线。');
  if (placedResistorIds.length === 0) return result('missing-part', '先放入电阻',
    '画布上还没有电阻，电路无法导通。', '本关只要求一个结果：让节点 A 约 4.5 V、总电流约 4.5 mA，怎么搭由你决定。',
    '从元件库拖电阻到搭建区，搭出你想到的网络。');
  if (!network.allSelected) return result('resistor-unselected', '还有电阻未选阻值',
    '未定阻值的支路不能求解。', level.concept,
    '逐只点击画布上的电阻，选择阻值。');
  if (!Number.isFinite(network.nodeAV) || !Number.isFinite(network.totalCurrentMa) ||
      placedResistorIds.some(id => {
        const part = network.resistorResults[id];
        return !part || !Number.isFinite(part.currentMa) || (part.currentMa <= 1e-6 && !part.bypassed);
      })) {
    return result('open-circuit', '网络尚未形成目标回路',
      '至少一条支路没有可计算的闭合电流。',
      '电流必须从电源经 R1 到达节点 A，再分别经过 R2、R3 返回 GND。悬空节点不会被当作 0 V。',
      '沿电源 → R1 → 分叉 → R2/R3 → GND 检查各端点。');
  }
  const bypassed = placedResistorIds.find(id => network.resistorResults[id]?.bypassed);
  if (bypassed) {
    const label = bypassed.toUpperCase();
    return result('resistor-short', label + ' 被导线短接',
      label + ' 两端电位相同、电流约为 0 mA，其余支路仍导通。',
      '电阻两端被一根导线直接连通时，电流绕过该电阻，其两端电压差为零。',
      '检查并删除绕过 ' + label + ' 的多余导线，让电流从该电阻流过。');
  }
  if (resistorResults.some(item => item.powerW > rated)) return result('resistor-overload', '电阻功率超过额定值',
    '至少一只电阻的耗散功率大于 ' + rated + ' W。',
    '按 P = I²R 检查每只电阻；实际过载可能导致发热或损坏。',
    '增大合适的阻值或调整网络连接，重新核对功率。');
  if (success) return result('success', '节点电压与总电流都符合目标',
    '节点 A 约 ' + network.nodeAV.toFixed(2) + ' V；总电流约 ' + network.totalCurrentMa.toFixed(2) + ' mA。',
    '这就是你的解法：流入节点 A 的电流等于流出的电流；沿任一回路，各段电压降之和等于电源 9 V。',
    '换一种结构再试一次：串联分压、多支路并联，都能达到同样的节点电压。');
  return result('target-mismatch', '电路导通，但测量值未达到目标',
    '节点 A 为 ' + network.nodeAV.toFixed(2) + ' V，总电流为 ' + network.totalCurrentMa.toFixed(2) + ' mA。',
    '检查串联电阻与两个并联支路的阻值。' + level.concept,
    '先预测改变哪只电阻会使节点电压接近 4.5 V，再用探针核对。');
}

function wireEndLabel(endpoint) {
  const [id, pin] = endpoint.split('.');
  if (id === 'ground') return 'GND';
  if (id === 'power') return '电源';
  if (id === 'nodeA') return '节点 A';
  return id.toUpperCase() + (pin ? '·' + pin : '');
}
function wireLabel(wire) {
  return wire.split('-').map(wireEndLabel).join(' → ');
}

// Diagnosis levels render a fully wired-looking circuit while hiding one fault:
// an open wire (ends have different potentials) or a short bypassing a resistor
// (its two ends are tied, current leaves the resistor at zero voltage).
function evaluateFaultDiagnosis(game, level, network) {
  const wireDiffs = level.circuit.solutionWires.map(wire => {
    const [a, b] = wire.split('-');
    const va = network.voltageAt(a);
    const vb = network.voltageAt(b);
    const finiteV = Number.isFinite(va) && Number.isFinite(vb);
    return { wire, key: normalizeWire(wire), va, vb, diff: finiteV ? Math.abs(va - vb) : null };
  });
  const resistorDiffs = (level.circuit.resistors || []).map(id => {
    const va = network.voltageAt(id + '.a');
    const vb = network.voltageAt(id + '.b');
    const finiteV = Number.isFinite(va) && Number.isFinite(vb);
    const result = network.resistorResults[id];
    return { id, va, vb, diff: finiteV ? Math.abs(va - vb) : null,
      currentMa: result?.currentMa ?? 0, bypassed: Boolean(result?.bypassed) };
  });
  const kind = game.faultKind;
  const playerOpen = new Set((game.suspectedWires || []).map(normalizeWire));
  const playerShort = game.suspectedShort || null;
  let exact = false;
  if (kind === 'open') {
    exact = playerShort === null && playerOpen.size === 1 && playerOpen.has(normalizeWire(game.hiddenOpenWire));
  } else if (kind === 'short') {
    exact = playerOpen.size === 0 && playerShort === game.hiddenShortId;
  }
  const totalCurrentMa = Number.isFinite(network.totalCurrentMa) ? network.totalCurrentMa : 0;
  const currentLabel = '约 ' + totalCurrentMa.toFixed(2) + ' mA';
  const flowEdges = Object.values(network.wireCurrents).map(item => [item.from, item.to]);
  const currentPath = { kind: 'resistor-network', currentMa: network.totalCurrentMa, currentLabel, flowLabel: level.circuit.flowLabel };
  const base = {
    checks: [exact], success: exact, currentLabel, currentPath, flowEdges,
    network, ledState: 'off', gpioWaveform: 'flat',
  };
  const result = (kind2, headline, observed, explanation, nextStep, extra = {}) => ({
    ...base, kind: kind2, headline, observed, explanation, nextStep, message: headline, ...extra,
  });
  if (exact && kind === 'open') {
    const broken = wireDiffs.find(item => item.key === normalizeWire(game.hiddenOpenWire));
    return result('success', '故障定位正确：开路！',
      '断开处 ' + wireLabel(broken.wire) + '：一端 ' + broken.va.toFixed(1) + ' V，另一端 ' + broken.vb.toFixed(1) + ' V，线上电流为 0。',
      '开路时回路电流为零，断点两侧电位不同；你通过逐线测量找到了它。',
      '真实修复：接好这根导线，回路恢复约 2.25 mA 正常电流。',
      { diagnosis: { kind: 'open', wire: broken.wire, label: wireLabel(broken.wire), va: broken.va, vb: broken.vb, diff: broken.diff } });
  }
  if (exact && kind === 'short') {
    const shortRes = resistorDiffs.find(item => item.id === game.hiddenShortId);
    return result('success', '故障定位正确：短路！',
      shortRes.id.toUpperCase() + ' 被旁路：两端都是 ' + shortRes.va.toFixed(1) + ' V、电流 0 mA；总电流 ' + totalCurrentMa.toFixed(2) + ' mA。',
      '短路时被旁路元件两端电压为零，电流从零电阻旁路线流过，总电流增大。',
      '真实修复：拆除旁路 ' + shortRes.id.toUpperCase() + ' 的导线，电流恢复约 2.25 mA。',
      { diagnosis: { kind: 'short', resistor: shortRes.id, label: shortRes.id.toUpperCase(), va: shortRes.va, vb: shortRes.vb } });
  }
  if (playerOpen.size === 0 && playerShort === null) {
    return result('diagnose-needed', '还没有标记故障位置',
      '总电流 ' + totalCurrentMa.toFixed(2) + ' mA（正常应约 2.25 mA），电路外观完整。',
      '先看总电流判断类型：电流为 0 是开路；电流偏大（约 3 mA）是短路。',
      '开路：逐根测导线两端，标记压差不为 0 的线；短路：逐只测电阻两端，标记压差为 0 的电阻。');
  }
  if (kind === 'open' && playerShort) {
    return result('diagnose-wrong', '不是短路',
      '你标记了 ' + playerShort.toUpperCase() + ' 被短接，但整条电路电流为 0。',
      '电阻被短接时总电流应增大到约 3 mA；总电流为 0 是开路特征（开路点上游的电阻也会因无电流而两端等电位，别被它误导）。',
      '取消该标记，改测导线两端，找出压差不为 0 的断线。');
  }
  if (kind === 'open') {
    const wrong = [...playerOpen].map(key => wireDiffs.find(item => item.key === key)).find(item => item.key !== normalizeWire(game.hiddenOpenWire));
    if (wrong) {
      return result('diagnose-wrong', '标记的导线不对',
        wireLabel(wrong.wire) + ' 两端都是 ' + wrong.va.toFixed(1) + ' V，是导通的。',
        '导通导线两端电位相同；只有断线两端有压差。',
        '取消错误标记，找到两端电压不等的那根线。');
    }
  }
  if (kind === 'short' && playerOpen.size) {
    const w = [...playerOpen].map(key => wireDiffs.find(item => item.key === key))[0];
    return result('diagnose-wrong', '不是开路',
      wireLabel(w.wire) + ' 两端都是 ' + w.va.toFixed(1) + ' V，是导通的；总电流 ' + totalCurrentMa.toFixed(2) + ' mA 并不为 0。',
      '开路时总电流应为 0；当前约 3 mA，是短路特征。',
      '取消导线标记，改测电阻两端，找出压差为 0 的那只。');
  }
  if (kind === 'short' && playerShort) {
    const r = resistorDiffs.find(item => item.id === playerShort);
    return result('diagnose-wrong', '标记的电阻没有被短接',
      r.id.toUpperCase() + ' 两端压差 ' + r.diff.toFixed(1) + ' V（' + r.va.toFixed(1) + ' / ' + r.vb.toFixed(1) + '），电流 ' + r.currentMa.toFixed(2) + ' mA。',
      '被短接的电阻两端压差为 0、电流为 0。',
      '取消标记，逐只测量，找到两端等电位的电阻。');
  }
  return result('diagnose-partial', '标记不完整', '请确认只标记了真正的故障位置。', level.concept, '重新核对测量读数。');
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
