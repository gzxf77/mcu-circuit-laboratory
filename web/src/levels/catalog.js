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
    story: '电源、节点 A 和 GND 已固定在搭建区。电路需要几只电阻、怎么连接，由你来决定——把元件库的电阻拖到画布上，搭一个能让节点 A 约 4.5 V 的网络。接线后可点击电阻调整阻值，再用探针测量节点 A 的电压。',
    concept: '用串并联等效电阻求总电流；同一节点的电压相同，流入节点的电流等于流出的电流。R1 两端压降与节点 A 电压之和应为 9 V。',
    knowledge: [
      { title: '欧姆定律 · 求电阻', formula: 'R = V / I',
        text: '电阻 = 电压 ÷ 电流。由电源电压和目标电流，反推该用多大电阻。' },
      { title: '电阻串并联', formula: '串联  R = R1 + R2\n并联  1/R = 1/R1 + 1/R2',
        text: '多只电阻组合后的总电阻：串联相加变大，并联后变小。' },
    ],
    initialReversed: false,
    board: { fixedParts: ['power', 'nodeA', 'ground'], positions: {
      power: { x: 175, y: 187 }, r1: { x: 345, y: 255 }, nodeA: { x: 493, y: 323 },
      r2: { x: 570, y: 391 }, r3: { x: 570, y: 527 }, ground: { x: 790, y: 527 },
    } },
    circuit: {
      source: 'power', ground: 'ground', resistors: ['r1', 'r2', 'r3'], nodeA: 'nodeA', defaultProbeTarget: 'nodeA',
      // Player-facing library shows one generic resistor; each drop takes the next slot.
      resistorSlots: [],
      baseWires: [],
      solutionWires: ['power-r1.a', 'r1.b-nodeA', 'nodeA-r2.a', 'nodeA-r3.a', 'r2.b-ground', 'r3.b-ground'],
    },
    electrical: {
      sourceV: 9, resistorOptionsOhms: [470, 1000, 1500, 2000, 2200, 3300, 4700],
      defaultOhms: { r1: 1000, r2: 1000, r3: 1000 },
      referenceOhms: { r1: 1000, r2: 2000, r3: 2000 },
      resistorRatedPowerW: 0.25,
    },
    parts: [
      { id: 'power', label: '9 V 电源', count: '×1' },
      { id: 'nodeA', label: '节点 A', count: '×1' },
      { id: 'resistor', label: '电阻', count: '∞' },
      { id: 'ground', label: 'GND', count: '×1' },
      { id: 'probe', label: '探针', count: '×1' },
    ],
    goals: [
      { id: 'network', label: '让节点 A 约 4.5 V、总电流约 4.5 mA——怎么搭都行', when: { all: [
        { metricBetween: { key: 'nodeAV', min: 4.45, max: 4.55 } },
        { metricBetween: { key: 'totalCurrentMa', min: 4.4, max: 4.6 } },
        { networkSafe: true },
      ] } },
    ],
  }),
  2: defineLevel({
    id: 2, model: 'resistor-dc-v1', title: '故障定位', chapter: '第一章 · 电路基础', chapterSubtitle: '开路与短路诊断',
    story: '这块串联电路看起来完好：电源、R1、R2、节点 A、R3、R4、GND 依次相连，导线一根不缺。但通电后读数不对——故障有两种可能：某根导线内部断开（开路），或某只电阻被一根看不见的导线旁路（短路）。先看总电流判断故障类型，再逐点测量，点击导线或电阻标记故障位置。',
    concept: '开路时整条回路电流为 0，断点两端出现电压差；短路时被旁路元件两端电压为 0，电流从零电阻旁路线流过，总电流增大。',
    knowledge: [
      { title: '开路（断线）', formula: 'I = 0\n断点两端  ΔV ≠ 0',
        text: '导线断开后回路不通、电流为零，断点两侧电位不同。' },
      { title: '短路（短接）', formula: 'U = 0\n电流走旁路，I 增大',
        text: '元件两端被零电阻导线连通时电压为零，电流绕过元件，总电流变大。' },
    ],
    initialReversed: false,
    board: { fixedParts: ['power', 'nodeA', 'ground', 'r1', 'r2', 'r3', 'r4'], positions: {
      power: { x: 175, y: 150 }, r1: { x: 330, y: 150 }, r2: { x: 485, y: 150 },
      nodeA: { x: 640, y: 290 }, r3: { x: 485, y: 430 }, r4: { x: 640, y: 570 }, ground: { x: 790, y: 570 },
    } },
    circuit: {
      source: 'power', ground: 'ground', resistors: ['r1', 'r2', 'r3', 'r4'], nodeA: 'nodeA',
      flowLabel: '9 V → R1 → R2 → 节点 A → R3 → R4 → GND（串联）',
      baseWires: [],
      solutionWires: ['power-r1.a', 'r1.b-r2.a', 'r2.b-nodeA', 'nodeA-r3.a', 'r3.b-r4.a', 'r4.b-ground'],
      hiddenOpenCandidates: ['power-r1.a', 'r1.b-r2.a', 'r2.b-nodeA', 'nodeA-r3.a', 'r3.b-r4.a', 'r4.b-ground'],
      hiddenShortCandidates: ['r1', 'r2', 'r3', 'r4'],
    },
    electrical: {
      sourceV: 9, resistorOptionsOhms: [470, 1000, 1500, 2000, 2200, 3300, 4700],
      defaultOhms: { r1: 1000, r2: 1000, r3: 1000, r4: 1000 },
      referenceOhms: { r1: 1000, r2: 1000, r3: 1000, r4: 1000 },
      resistorRatedPowerW: 0.25,
    },
    parts: [
      { id: 'power', label: '9 V 电源', count: '×1' },
      { id: 'r1', label: 'R1', count: '×1' },
      { id: 'r2', label: 'R2', count: '×1' },
      { id: 'nodeA', label: '节点 A', count: '×1' },
      { id: 'r3', label: 'R3', count: '×1' },
      { id: 'r4', label: 'R4', count: '×1' },
      { id: 'ground', label: 'GND', count: '×1' },
      { id: 'probe', label: '探针', count: '×1' },
    ],
    goals: [
      { id: 'diagnose', label: '测量判断是开路还是短路，并点击标记故障位置', when: { diagnoseFault: true } },
    ],
  }),
});

export const levelIds = Object.freeze(Object.keys(levels).map(Number).sort((a, b) => a - b));
export const defaultLevel = levels[1];
export const getLevel = id => levels[Number(id)] || defaultLevel;
export const getNextLevel = id => levels[levelIds.find(nextId => nextId > Number(id))] || null;
