import { geometryWireKey } from './circuitGeometry.js';
import { wirePath } from './currentPaths.js';
import { defaultLevel } from './levels/catalog.js';
import { electricalFor } from './levelElectrical.js';

export const defaultProbe = Object.freeze({ x: 485, y: 500, target: null, wire: null });

function connectedNodes(game, start) {
  const neighbors = new Map();
  for (const wire of game.wires) {
    const [a, b] = wire.split('-');
    if (!neighbors.has(a)) neighbors.set(a, []);
    if (!neighbors.has(b)) neighbors.set(b, []);
    neighbors.get(a).push(b);
    neighbors.get(b).push(a);
  }
  const found = new Set([start]);
  const queue = [start];
  for (let index = 0; index < queue.length; index++) {
    for (const next of neighbors.get(queue[index]) || []) {
      if (!found.has(next)) { found.add(next); queue.push(next); }
    }
  }
  return found;
}

const voltageText = voltageV => voltageV === 0 ? '0 V' : voltageV.toFixed(1) + ' V';

function readResistorProbe(game, report, probe, level) {
  if (!probe) return {
    pointLabel: '探针未放置', target: null, voltageLabel: '—', voltageV: null,
    currentLabel: '—', currentMa: null, currentDetail: '拖入探针后读取节点电压和支路电流估算。',
    waveform: 'idle', detail: '把探针移到端点或导线。',
  };
  const target = probe.target;
  const id = target?.split('.')[0];
  const pointLabel = target === level.circuit.source ? '电源正端'
    : target === level.circuit.ground ? 'GND'
      : target && wirePath(game, level.circuit.nodeA, target) !== null ? '节点 A' + (target === level.circuit.nodeA ? '' : '（' + id.toUpperCase() + (target.endsWith('.a') ? ' 左端' : ' 右端') + '）')
      : target ? id.toUpperCase() + (target.endsWith('.a') ? ' 左端' : ' 右端') : '未接触电路';
  const voltageV = target ? report.network.voltageAt(target) : null;
  const branch = report.network.resistorResults[id];
  const wireCurrent = probe.wire && report.network.wireCurrents[probe.wire];
  // Probe on a plain wire node (e.g. node A): read the currents of wires touching
  // that pin. A pass-through node has one unique current; a split node's largest
  // wire current is the total current entering the node (KCL).
  const touching = Object.values(report.network.wireCurrents)
    .filter(w => w && (w.from === target || w.to === target))
    .map(w => w.currentMa).filter(Number.isFinite);
  const nodeWireCurrent = touching.length ? Math.max(...touching) : null;
  const currentMa = !target || report.network.shorted ? null
    : wireCurrent ? wireCurrent.currentMa
      : probe.wire ? 0
        : branch?.currentMa ?? nodeWireCurrent ?? (target === level.circuit.source || target === level.circuit.ground
          ? report.network.totalCurrentMa : 0);
  return {
    pointLabel, target,
    voltageV: Number.isFinite(voltageV) ? voltageV : null,
    voltageLabel: report.network.shorted ? '短路' : Number.isFinite(voltageV) ? voltageText(voltageV) : target ? '悬空/未求解' : '未接触',
    currentMa: Number.isFinite(currentMa) ? currentMa : null,
    currentLabel: !target ? '—' : Number.isFinite(currentMa) ? currentMa.toFixed(2) + ' mA' : '无法确定',
    currentDetail: !target ? '探针尚未接触导线或端点。' : '电流是该端点所属元件或导线支路的模型估算；理想导线环路中的分流不能唯一确定。',
    waveform: Number.isFinite(voltageV) && !report.network.shorted ? 'flat' : 'unknown',
    detail: report.network.shorted ? '电源短路，停止求解。'
      : Number.isFinite(voltageV) ? '相对 GND 的直流电压；支路电流由欧姆定律与 KCL 求得。'
        : '该节点未形成可确定电位的连接，不能当作 0 V。',
  };
}

export function readProbe(game, report, probe, level = defaultLevel) {
  if (level.model === 'resistor-dc-v1') return readResistorProbe(game, report, probe, level);
  const c = level.circuit;
  const e = electricalFor(game, level);
  const pointNames = {
    [c.supply]: e.gpioHighV.toFixed(1) + ' V 电源', [c.ground]: 'GND',
    [c.mcuVdd]: 'MCU VDD', [c.gpio]: 'GPIO0', [c.mcuGround]: 'MCU GND',
    [c.resistor[0]]: '电阻左端', [c.resistor[1]]: '电阻右端',
    [c.led[0]]: game.reversed ? 'LED 阴极' : 'LED 阳极',
    [c.led[1]]: game.reversed ? 'LED 阳极' : 'LED 阴极',
  };
  if (!probe) return {
    pointLabel: '探针未放置', target: null, voltageLabel: '—', voltageV: null,
    currentLabel: '—', currentMa: null, currentDetail: '拖入探针后读取支路电流。',
    waveform: 'idle', detail: '从元件库拖入探针，再移到端点或导线。',
  };
  const pointLabel = probe.target ? pointNames[probe.target] || probe.target : '未接触电路';
  const current = (() => {
    if (!probe.target) return { currentLabel: '—', currentMa: null, currentDetail: '探针尚未接触导线或端点。' };
    if (['supply-short', 'gpio-short', 'overcurrent'].includes(report.kind) || report.currentLabel === '未计算') {
      return { currentLabel: '无法确定', currentMa: null, currentDetail: '当前故障使支路电流无法可靠估算。' };
    }
    const path = report.currentPath;
    const flowing = probe.wire
      ? path?.flowEdges.some(([a, b]) => geometryWireKey(a, b) === probe.wire)
      : path?.flowEdges.some(([a, b]) => a === probe.target || b === probe.target);
    return flowing
      ? { currentLabel: path.currentLabel, currentMa: path.currentMa, currentDetail: '这是所接支路的教学模型估算电流。' }
      : { currentLabel: '0 mA', currentMa: 0, currentDetail: '此测点没有已识别的导通电流。' };
  })();
  const common = { pointLabel, target: probe.target, ...current };
  const unreadable = (voltageLabel, detail, waveform = 'unknown') => ({
    ...common, voltageLabel, voltageV: null, waveform, detail,
  });
  const known = (voltageV, waveform, detail) => ({
    ...common, voltageLabel: voltageText(voltageV), voltageV, waveform, detail,
  });

  if (!probe.target) return unreadable('未接触', '拖动探针尖端到端点或导线。');
  const net = connectedNodes(game, probe.target);
  const touches = node => net.has(node);
  if (touches(c.supply) && touches(c.ground)) return unreadable('短路', '电源与 GND 短接，节点电压不能由本关模型可靠求出。');
  if (probe.target === c.ground) return known(0, 'flat', '相对 GND 的参考电压为 0 V。');
  if (touches(c.gpio) && touches(c.ground) && report.gpioWaveform === 'unknown') return unreadable('输出异常', 'GPIO0 与 GND 短接，输出电压未可靠求出。');
  if (touches(c.ground)) return known(0, 'flat', '此测点通过导线接到 GND。');
  if (report.kind === 'supply-short') return unreadable('未求解', '供电短路后，本关模型停止计算其他节点电压。');
  if (touches(c.supply)) return known(e.gpioHighV, 'flat', '此测点通过导线接到 ' + e.gpioHighV.toFixed(1) + ' V 电源。');

  if (touches(c.gpio)) {
    if (report.gpioWaveform === 'step') return known(e.gpioHighV, 'step', 'GPIO0 在 10 ms 时由低电平切换到高电平。');
    return unreadable('输出异常', 'GPIO0 未正常供电或发生过载，电压未可靠求出。');
  }

  if (report.currentPath?.kind === 'led-series' && (touches(c.resistor[1]) || touches(game.reversed ? c.led[1] : c.led[0]))) {
    return known(e.ledForwardV, 'step', '目标支路导通；这里按本关 LED 约 ' + e.ledForwardV.toFixed(1) + ' V 正向压降估算。');
  }
  if (report.kind === 'reversed' && game.placed.resistor &&
      wirePath(game, c.gpio, c.resistor[0])?.length &&
      (touches(c.resistor[1]) || touches(c.led[0]))) {
    return known(e.gpioHighV, 'step', 'LED 反接时近似没有电流，电阻两端也近似没有压降。');
  }
  return unreadable('悬空/未求解', '此节点未形成可由本关简化模型确定的电压；不要把它当作 0 V。');
}
