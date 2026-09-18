import { defineLevel } from './defineLevel.js';

const positions = {
  mcu: { x: 176, y: 337 }, power: { x: 379, y: 154 }, ground: { x: 790, y: 489 },
  resistor: { x: 462, y: 332 }, led: { x: 664, y: 332 },
};
const solutionWires = ['power-mcu.vdd', 'mcu.gnd-ground', 'mcu.gpio-resistor.a', 'resistor.b-led.a', 'led.b-ground'];

// One circuit family can be configured for later lessons without per-level UI logic.
export function makeGpioLedLevel({
  id, title, chapter, chapterSubtitle, story, voltageV, ledForwardV,
  resistorOhms = null, resistorOptionsOhms = null, warningCurrentMa,
  resistorRatedPowerW = 0.25, ledVisualFullScaleMa = 15,
  minimumCurrentMa = null, initialReversed = false, measurement = null, concept = null, experiments = [],
}) {
  const choosingResistor = Array.isArray(resistorOptionsOhms);
  const circuit = {
    supply: 'power', ground: 'ground', mcuVdd: 'mcu.vdd', mcuGround: 'mcu.gnd', gpio: 'mcu.gpio',
    resistor: ['resistor.a', 'resistor.b'], led: ['led.a', 'led.b'],
    baseWires: solutionWires.slice(0, 2), solutionWires: [...solutionWires],
  };
  const goals = [
    { id: 'supply', label: '让 MCU 正确上电并从 GPIO0 输出高电平', when: { all: [{ placed: 'mcu' }, { placed: 'power' }, { placed: 'ground' }, { wire: ['power', 'mcu.vdd'] }, { wire: ['mcu.gnd', 'ground'] }] } },
    { id: 'resistor', label: choosingResistor ? '自选阻值，并把电阻串入 GPIO0 与 LED 之间' : '正确串联 ' + resistorOhms + ' Ω 限流电阻', when: { all: [
      { placed: 'mcu' }, { placed: 'resistor' }, { placed: 'led' }, { wire: ['mcu.gpio', 'resistor.a'] }, { wire: ['resistor.b', 'led.a'] },
      ...(choosingResistor ? [{ resistorSelected: true }] : []),
    ] } },
    { id: 'led', label: 'LED 按正确极性接地', when: { all: [{ goal: 'resistor' }, { placed: 'ground' }, { wire: ['led.b', 'ground'] }, { orientation: 'forward' }] } },
    { id: 'safe', label: minimumCurrentMa === null ? '观察支路电流，并低于本关 ' + warningCurrentMa + ' mA 比较线' : '使支路电流达到 ' + minimumCurrentMa + ' mA 且低于 ' + warningCurrentMa + ' mA', when: { all: [
      { goal: 'supply' }, { goal: 'led' }, { allowedWires: true }, { pathKind: 'led-series' },
      ...(minimumCurrentMa === null ? [{ currentUnder: warningCurrentMa }] : [{ currentBetween: { min: minimumCurrentMa, max: warningCurrentMa } }]),
      { resistorPowerUnder: resistorRatedPowerW },
    ] } },
  ];
  if (measurement) goals.push({ id: 'measurement', label: measurement.label, when: { all: [{ goal: 'safe' }, { probeAt: measurement.target }] } });
  return defineLevel({
    id, model: 'gpio-led-series-v1', title, chapter, chapterSubtitle, story,
    initialReversed, measurement, concept, experiments,
    board: { positions: structuredClone(positions) }, circuit,
    electrical: { gpioHighV: voltageV, ledForwardV, resistorOhms, resistorOptionsOhms, warningCurrentMa, minimumCurrentMa, resistorRatedPowerW, ledVisualFullScaleMa },
    parts: [
      { id: 'mcu', label: 'MCU', count: '×1' }, { id: 'resistor', label: choosingResistor ? '限流电阻' : '电阻', count: '×1' },
      { id: 'led', label: 'LED', count: '×1' }, { id: 'power', label: voltageV.toFixed(1) + ' V 电源', count: '×1' },
      { id: 'ground', label: 'GND', count: '×1' }, { id: 'wire', label: '导线', count: '∞' },
      { id: 'probe', label: '探针', count: '×1' },
    ],
    goals,
  });
}

export const levels = Object.freeze({
  1: defineLevel({
    id: 1, model: 'resistor-dc-v1', title: '让电流走一圈', chapter: '第一章 · 电路基础', chapterSubtitle: '闭合回路与串联分压',
    story: '9 V 电源、节点 A 和 GND 已固定。拖入 R1、R2，把它们串起来，形成从电源经 A 返回 GND 的回路。先看电流有没有流动，再用探针测 A 点；改变阻值，试着让 A 点的电压成为电源的一半。',
    concept: '观察顺序：断开时没有闭合电流；闭合后两个串联电阻流过相同电流。电流可用 I = U ÷ (R1 + R2) 估算；两只电阻的压降相加等于电源电压。节点电压以 GND 为 0 V 参考。',
    textbook: '邱关源《电路》第6版：§1-2 电流和电压的参考方向、§1-3 电功率和能量、§1-4 电路元件、§1-8 基尔霍夫定律、§2-2 电阻的串联和并联。首关只实验串联回路与压降。',
    experiments: ['断开 R2 到 GND 的导线，再接回去：比较电流动画和探针读数。', '保持两个阻值相同，一起调大它们：A 点仍在中间吗？电流和功率怎样变化？', '只调大 R2，再只调大 R1：观察 A 点电压向哪边移动。'],
    completion: {
      detail: '你接通了串联回路，并用探针验证了中点电压。',
      note: '串联处处同流；R1 与 R2 的压降相加等于电源电压。',
      metrics: [
        { label: '节点 A', keys: ['nodeAV'], unit: ' V' },
        { label: '串联电流', keys: ['totalCurrentMa'], unit: ' mA' },
        { label: 'R1 / R2 压降', keys: ['r1DropV', 'r2DropV'], unit: ' V' },
      ],
    },
    initialReversed: false,
    board: { fixedParts: ['power', 'nodeA', 'ground'], positions: {
      power: { x: 120, y: 350 }, r1: { x: 300, y: 350 }, nodeA: { x: 480, y: 350 },
      r2: { x: 650, y: 350 }, ground: { x: 820, y: 350 },
    } },
    circuit: {
      source: 'power', ground: 'ground', resistors: ['r1', 'r2'], nodeA: 'nodeA',
      flowLabel: '9 V 电源 → R1 → 节点 A → R2 → GND',
      baseWires: [],
      solutionWires: ['power-r1.a', 'r1.b-nodeA', 'nodeA-r2.a', 'r2.b-ground'],
    },
    electrical: {
      sourceV: 9, resistorOptionsOhms: [470, 1000, 1500, 2000, 2200, 3300],
      defaultOhms: { r1: 1000, r2: 2000 },
      referenceOhms: { r1: 1000, r2: 1000 },
      resistorRatedPowerW: 0.25,
    },
    parts: [
      { id: 'power', label: '9 V 电源', count: '×1' },
      { id: 'nodeA', label: '节点 A', count: '×1' },
      { id: 'r1', label: 'R1 · 电阻', count: '×1' },
      { id: 'r2', label: 'R2 · 电阻', count: '×1' },
      { id: 'ground', label: 'GND', count: '×1' },
      { id: 'wire', label: '导线', count: '∞' }, { id: 'probe', label: '探针', count: '×1' },
    ],
    goals: [
      { id: 'loop', label: '接通 R1、R2 的串联回路，观察两处电流', when: { seriesConducting: true } },
      { id: 'measure', label: '把探针移到节点 A，测量它相对 GND 的电压', when: { all: [
        { goal: 'loop' }, { probeAt: 'nodeA' },
      ] } },
      { id: 'half', label: '调整阻值，使 A 点约为电源电压的一半', when: { all: [
        { goal: 'measure' }, { metricBetween: { key: 'nodeAV', min: 4.45, max: 4.55 } },
      ] } },
      { id: 'safe', label: '两个电阻均在额定功率内', when: { all: [
        { goal: 'half' }, { networkSafe: true },
      ] } },
    ],
  }),
});

export const levelIds = Object.freeze(Object.keys(levels).map(Number).sort((a, b) => a - b));
export const defaultLevel = levels[1];
export const getLevel = id => levels[Number(id)] || defaultLevel;
export const getNextLevel = id => levels[levelIds.find(nextId => nextId > Number(id))] || null;
