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
    id: 1, model: 'resistor-dc-v1', title: '分流节点', chapter: '第一章 · 电路基础', chapterSubtitle: '串并联与节点电流',
    story: '电源、节点 A 和 GND 已固定在搭建区。选择并放置 R1、R2、R3：让 R1 连接电源与 A，让 R2、R3 分别从 A 接地。先预测节点 A 的电压，再接线测量。',
    concept: '用串并联等效电阻求总电流；同一节点的电压相同，流入节点的电流等于流出的电流。R1 两端压降与节点 A 电压之和应为 9 V。',
    experiments: ['交换 R2、R3 的阻值，比较支路电流。', '断开一条支路，观察节点电压和总电流如何变化。', '比较三只电阻的耗散功率。'],
    initialReversed: false,
    board: { fixedParts: ['power', 'nodeA', 'ground'], positions: {
      power: { x: 175, y: 187 }, r1: { x: 345, y: 255 }, nodeA: { x: 493, y: 323 },
      r2: { x: 570, y: 391 }, r3: { x: 570, y: 527 }, ground: { x: 790, y: 527 },
    } },
    circuit: {
      source: 'power', ground: 'ground', resistors: ['r1', 'r2', 'r3'], nodeA: 'nodeA',
      flowLabel: '9 V 电源 → R1 → R2 ∥ R3 → GND',
      baseWires: [],
      solutionWires: ['power-r1.a', 'r1.b-nodeA', 'nodeA-r2.a', 'nodeA-r3.a', 'r2.b-ground', 'r3.b-ground'],
    },
    electrical: {
      sourceV: 9, resistorOptionsOhms: [470, 1000, 1500, 2000, 2200, 3300, 4700],
      referenceOhms: { r1: 1000, r2: 2000, r3: 2000 },
      resistorRatedPowerW: 0.25,
    },
    parts: [
      { id: 'power', label: '9 V 电源', count: '×1' },
      { id: 'nodeA', label: '节点 A', count: '×1' },
      { id: 'r1', label: 'R1 · 串联电阻', count: '×1' },
      { id: 'r2', label: 'R2 · 支路电阻', count: '×1' },
      { id: 'r3', label: 'R3 · 支路电阻', count: '×1' },
      { id: 'ground', label: 'GND', count: '×1' },
      { id: 'wire', label: '导线', count: '∞' }, { id: 'probe', label: '探针', count: '×1' },
    ],
    goals: [
      { id: 'parts', label: '放入 R1、R2、R3 并分别选择阻值', when: { all: [
        { placed: 'power' }, { placed: 'nodeA' }, { placed: 'ground' }, { placed: 'r1' }, { placed: 'r2' }, { placed: 'r3' },
        { resistorValuesSelected: true },
      ] } },
      { id: 'voltage', label: '使节点 A 的电压约为 4.5 V', when: { metricBetween: { key: 'nodeAV', min: 4.45, max: 4.55 } } },
      { id: 'currents', label: '总电流约 4.5 mA，两条支路各约 2.25 mA', when: { all: [
        { metricBetween: { key: 'totalCurrentMa', min: 4.4, max: 4.6 } },
        { metricBetween: { key: 'r2CurrentMa', min: 2.15, max: 2.35 } },
        { metricBetween: { key: 'r3CurrentMa', min: 2.15, max: 2.35 } },
      ] } },
      { id: 'safe', label: '三只电阻安全导通，功率低于额定值', when: { all: [
        { goal: 'parts' }, { goal: 'voltage' }, { goal: 'currents' }, { networkSafe: true },
      ] } },
    ],
  }),
});

export const levelIds = Object.freeze(Object.keys(levels).map(Number).sort((a, b) => a - b));
export const defaultLevel = levels[1];
export const getLevel = id => levels[Number(id)] || defaultLevel;
export const getNextLevel = id => levels[levelIds.find(nextId => nextId > Number(id))] || null;
