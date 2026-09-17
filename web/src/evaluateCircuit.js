// Shared runtime for the GPIO → resistor → LED circuit family. The app passes a
// level definition; this file contains no level numbers or fixed component values.
import { detectCurrentPath, wirePath } from './currentPaths.js';
import { resolveComponentStates } from './componentStates.js';
import { evaluateGoals } from './engine/goalRules.js';
import { electricalFor, estimateSeriesCurrentMa } from './levelElectrical.js';
import { defaultLevel } from './levels/catalog.js';

export const wireKey = (a, b) => [a, b].sort().join('-');
export const normalizeWire = wire => wireKey(...wire.split('-'));
// Shared wiring aliases for the introductory GPIO → LED family.
export const baseWires = defaultLevel.circuit.baseWires;
export const solutionWires = defaultLevel.circuit.solutionWires;

export function startGame(solved = false, level = defaultLevel) {
  return {
    levelId: level.id,
    placed: Object.fromEntries(level.parts.filter(part => !['wire', 'probe'].includes(part.id)).map(part => [part.id, solved])),
    wires: solved ? [...level.circuit.solutionWires] : [],
    reversed: solved ? false : level.initialReversed,
    resistorOhms: level.electrical.resistorOhms,
    positions: structuredClone(level.board.positions),
  };
}

const modelRegistry = { 'gpio-led-series-v1': evaluateGpioLedSeries };

export function evaluateCircuit(game, level = defaultLevel, probe = null) {
  const model = modelRegistry[level.model];
  if (!model) throw new Error('Unsupported circuit model: ' + level.model);
  if (game.levelId && game.levelId !== level.id) throw new Error('Game state belongs to a different level');
  const report = model(game, level, probe);
  return { ...report, componentStates: resolveComponentStates(game, level, report) };
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
