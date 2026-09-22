import { defineLevel } from './defineLevel.js';

const positions = {
  mcu: { x: 176, y: 337 }, power: { x: 379, y: 154 }, ground: { x: 790, y: 489 },
  resistor: { x: 462, y: 332 }, led: { x: 664, y: 332 },
};
const solutionWires = ['power-mcu.vdd', 'mcu.gnd-ground', 'mcu.gpio-resistor.a', 'resistor.b-led.a', 'led.b-ground'];

// Legacy gpio-led template, kept as a separate valid level factory (also covered by tests).
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

// 第 1 章重做：严格按邱关源《电路》第 6 版习题逐题游戏化。
// 第 1 关 = 习题 1-1：二端元件的参考方向（关联/非关联）与功率符号。
// 关卡电路已预接好（题1-1 给出的是图，不需要玩家搭建），玩家只需对
// 电压源（元件）和电阻 R1 分别判断吸收/发出——判断必须与电路真实功率一致。
export const levels = Object.freeze({
  1: defineLevel({
    id: 1,
    model: 'resistor-dc-v1',
    title: '题1-1 · 参考方向与功率',
    chapter: '第一章 · 电路模型和电路定律',
    chapterSubtitle: '谁在吸收，谁在发出',
    story: '题1-1：二端元件左端标 +、右端标 −，电压 u 加在两端，电流 i 的箭头方向决定参考方向。本关电路是 12 V 电源经 R1 回到电源——分别看电源和 R1：电流 i 是从标 + 的端子流入还是流出？这又决定了 ui 表示吸收功率还是发出功率。',
    concept: '关联参考方向：电流从标 + 的端子流入，P = ui，ui 表示吸收功率。非关联：电流从 + 端流出，ui 直接表示发出功率。电阻的电流从 + 端流入，是关联；电压源的电流从 + 端流出，是非关联。',
    knowledge: [
      { title: '关联参考方向', formula: '关联：电流从电压 + 端流入、− 端流出\n非关联：电流从 + 端流出、− 端流入',
        text: '对一个二端元件，先选定电压参考极性（+、−），再选定电流参考方向（箭头）。若电流从 + 端流入、从 − 端流出，称电压、电流取关联参考方向；反之即为非关联。选定关联方向后，功率公式 P = ui 的正负号才能统一解释。' },
      { title: '功率的吸收与发出', formula: '关联：P = ui，P > 0 吸收，P < 0 发出\n非关联：P = −ui，P > 0 吸收，P < 0 发出',
        text: '关联参考方向下，P = ui；P > 0 表示元件吸收功率（消耗电能），P < 0 表示发出功率（向外提供电能）。非关联参考方向下则取 P = −ui，判读规则相同。由此可判断元件是在耗能还是在供能。' },
    ],
    intro: '在电路分析中，当涉及某个元件或部分电路的电流或电压时，必须指定电流或电压的参考方向（有时也称为正方向），才能开始进行分析和计算。在电路中，电流的实际流动方向或电压的实际方向可能是未知的，也可能是随时间变动的。',
    initialReversed: false,
    // 纯判断题关卡：不搭建、不测量。隐藏元件库/实时测量，板上不显示电压与阻值，
    // 答题卡并排展示所有待判断元件。
    ui: { judgeOnly: true, randomDirection: true },
    // 向右时：r1 关联(in)、power 非关联(out)；向左时整体取反。
    judgedAssociation: { r1: true, power: false },
    judgeLabels: { r1: '元件' },
    // 每次随机 u、i 的正负号。
    randomSigns: { r1: true },
    board: {
      fixedParts: ['power', 'r1', 'ground'],
      positions: {
        power: { x: 210, y: 350 },
        r1: { x: 455, y: 350 },
        ground: { x: 700, y: 350 },
      },
    },
    circuit: {
      source: 'power',
      ground: 'ground',
      // R1 左端即原节点 A，兼作参考电压点；板上不再单独画节点符号。
      nodeA: 'r1.a',
      flowLabel: '12 V 电源 → R1 → GND',
      // 题1-1 给的是两个参考方向示意图：R1 即图(a)（电流从 + 端流入），
      // 电源即图(b)（电流从 + 端流出）。电路已预接好，玩家只做参考方向与功率判断。
      resistors: ['r1'],
      resistorSlots: [],
      solutionWires: ['power-r1.a', 'r1.b-ground'],
      initialWires: ['power-r1.a', 'r1.b-ground'],
    },
    electrical: {
      sourceV: 12,
      scopeMaxV: 15,
      resistorOptionsOhms: [1000],
      defaultOhms: { r1: 1000 },
      referenceOhms: { r1: 1000 },
      resistorRatedPowerW: 0.25,
    },
    parts: [
      { id: 'power', label: '12 V 电源（图 b）', count: '×1' },
      { id: 'ground', label: 'GND', count: '×1' },
    ],
    goals: [
      // 题1-1(1)(2)：先判参考方向是否关联、再判 ui 表示什么功率。
      // R1 电流从 + 端流入 → 关联，ui 表示吸收；电源电流从 + 端流出 → 非关联，ui 表示发出。
      { id: 'convention', label: '判断 R1 的参考方向是否关联，以及 ui 表示什么功率', when: { all: [
        { assocJudged: { id: 'r1', expect: 'in' } },
        { uiMeaningJudged: { id: 'r1', expect: 'absorb' } },
        { powerJudged: { id: 'r1', expect: 'absorb' } },
      ] } },
    ],
  }),
  2: defineLevel({
    id: 2,
    model: 'resistor-dc-v1',
    title: '题1-2 · 同一对 u、i 下的两个网络',
    chapter: '第一章 · 电路模型和电路定律',
    chapterSubtitle: '同一个电压电流，两个网络',
    story: '题1-2：N_A 与 N_B 是两个二端网络，用上下两根线连起来。电压 u 标在上线 +、下线 −；电流 i 画在上线上。图(a) i 的箭头朝右，图(b) 朝左。对每个网络分别判断：电流 i 是从它标 + 的端子流入还是流出？ui 表示吸收还是发出？',
    concept: '同一个端口电压 u、同一根线上的电流 i，对在线两端的两个网络含义相反：电流流入哪一端网络，哪一端就是关联（ui 表吸收），另一端电流从 + 端流出，就是非关联（ui 表发出）。',
    intro: '两个二端网络用上下两根导线连成一个回路，共用同一个端口电压 u（上线 +、下线 −）和同一条线上的电流 i。对在线路两端的两个网络来说，同一个电压、电流的参考方向含义正好相反。',
    knowledge: [
      { title: '串联线上的电流方向', formula: 'i 流入 N_A 端 ⇔ i 流出 N_B 端',
        text: '在同一根串联导线上，电流从一个网络的 + 端流入，必从另一个网络的 + 端流出。因此两个网络的关联状态必然相反：一个关联，另一个必为非关联。' },
      { title: '分别判断关联与功率', formula: '电流从 + 端流入 → 关联 → ui 表吸收\n电流从 + 端流出 → 非关联 → ui 表发出',
        text: '对每个网络单独看：u 的 + 都在上线。i 的箭头指进哪个网络，哪个网络就是电流从 + 端流入，取关联参考方向，ui 表示吸收功率；另一个网络则为非关联，ui 表示发出功率。' },
    ],
    intro: '在电路分析中，当涉及某个元件或部分电路的电流或电压时，必须指定电流或电压的参考方向（有时也称为正方向），才能开始进行分析和计算。在电路中，电流的实际流动方向或电压的实际方向可能是未知的，也可能是随时间变动的。',
    initialReversed: false,
    ui: { judgeOnly: true, abstract: true },
    // 题1-2：两幅图，每幅两个盒子。truth：i 箭头朝右时 N_A 流出(非关联)、N_B 流入(关联)；朝左相反。
    judgeLabels: { na: 'N_A', nb: 'N_B' },
    // 向右时：N_A 非关联(out)、N_B 关联(in)；向左时整体取反。
    judgedAssociation: { na: false, nb: true },
    abstract: {
      randomDirection: true,
      boxes: [
        { id: 'na', label: 'N_A', x: 300, y: 350 },
        { id: 'nb', label: 'N_B', x: 600, y: 350 },
      ],
    },
    board: {
      fixedParts: ['power', 'r1', 'ground'],
      positions: { power: {x:175,y:300}, r1: {x:420,y:300}, ground: {x:665,y:300} },
    },
    circuit: {
      source: 'power',
      ground: 'ground',
      nodeA: 'r1.a',
      flowLabel: '题1-2',
      resistors: ['r1'],
      resistorSlots: [],
      solutionWires: ['power-r1.a', 'r1.b-ground'],
      initialWires: ['power-r1.a', 'r1.b-ground'],
    },
    electrical: {
      sourceV: 12,
      scopeMaxV: 15,
      resistorOptionsOhms: [1000],
      defaultOhms: { r1: 1000 },
      referenceOhms: { r1: 1000 },
      resistorRatedPowerW: 0.25,
    },
    parts: [
      { id: 'power', label: '12 V 电源', count: '×1' },
      { id: 'ground', label: 'GND', count: '×1' },
    ],
    goals: [
      { id: 'convention', label: '判断 N_A、N_B 是否关联、ui 表示什么功率（电流方向每次随机）', when: { all: [
        { assocJudged: { id: 'na', expect: 'out' } },
        { uiMeaningJudged: { id: 'na', expect: 'deliver' } },
        { assocJudged: { id: 'nb', expect: 'in' } },
        { uiMeaningJudged: { id: 'nb', expect: 'absorb' } },
      ] } },
    ],
  }),
  3: defineLevel({
    id: 3,
    model: 'resistor-dc-v1',
    title: '题1-3 · KCL/KVL 与功率平衡',
    chapter: '第一章 · 电路模型和电路定律',
    chapterSubtitle: '用 KCL/KVL 求各元件功率',
    story: '题1-3 图(a)：N_A 与 N_B 用上下两线连接，中间支路接电流源 I_S。已知 I1=500mA，I_S=100mA，U=30V。先用 KCL、KVL 判断每个元件的电压电流方向，再求它们各自吸收的功率。',
    concept: '在节点上用 KCL 求未知支路电流，沿回路用 KVL 求未知元件电压；确定每个元件电压、电流的实际方向后，再按关联/非关联判断功率是吸收还是发出。',
    intro: '对含有多个元件的电路，先在节点上用 KCL 求出各支路电流，再沿回路用 KVL 求出各元件电压；电压电流方向都确定后，才能按关联参考方向计算每个元件吸收或发出的功率。',
    knowledge: [
      { title: '节点电流定律 KCL', formula: 'Σ 流入 = Σ 流出',
        text: '对任一节点，流入电流之和等于流出电流之和。本题在上端中间节点：I1 = I右 + I_S，故流进 N_B 的电流 = I1 − I_S = 400 mA。' },
      { title: '功率平衡', formula: 'Σ 吸收 = Σ 发出',
        text: '整个电路发出的功率等于吸收的功率。本题 N_A 发出 15 W，N_B 吸收 12 W、电流源吸收 3 W，二者相等，可用来校验。' },
    ],
    initialReversed: false,
    ui: { judgeOnly: true, abstract: true },
    judgeLabels: { na: 'N_A', nb: 'N_B', cs: '电流源' },
    // 固定方向（本题数值给定）。N_A 电流从 + 端流出(非关联)；N_B、电流源电流从 + 端流入(关联)。
    judgedAssociation: { na: false, nb: true, cs: true },
    judgementSigns: { na: { u: 1, i: 1 }, nb: { u: 1, i: 1 }, cs: { u: 1, i: 1 } },
    abstract: {
      figure: 'kcl',
      boxes: [
        { id: 'na', label: 'N_A', x: 250, y: 350 },
        { id: 'nb', label: 'N_B', x: 650, y: 350 },
      ],
    },
    board: {
      fixedParts: ['power', 'r1', 'ground'],
      positions: { power: {x:175,y:350}, r1: {x:455,y:350}, ground: {x:700,y:350} },
    },
    circuit: {
      source: 'power', ground: 'ground', nodeA: 'r1.a', flowLabel: '题1-3',
      resistors: ['r1'], resistorSlots: [],
      solutionWires: ['power-r1.a', 'r1.b-ground'],
      initialWires: ['power-r1.a', 'r1.b-ground'],
    },
    electrical: {
      sourceV: 12, scopeMaxV: 15, resistorOptionsOhms: [1000],
      defaultOhms: { r1: 1000 }, referenceOhms: { r1: 1000 }, resistorRatedPowerW: 0.25,
    },
    parts: [ { id: 'power', label: '电源', count: '×1' }, { id: 'ground', label: 'GND', count: '×1' } ],
    goals: [
      { id: 'power', label: '填入各元件吸收的功率（W），负号表示发出', when: { all: [
        { powerValueJudged: { id: 'na', expect: -15 } },
        { powerValueJudged: { id: 'nb', expect: 12 } },
        { powerValueJudged: { id: 'cs', expect: 3 } },
      ] } },
    ],
  }),
});

export const levelIds = Object.freeze(Object.keys(levels).map(Number).sort((a, b) => a - b));
export const defaultLevel = levels[1];
export const getLevel = id => levels[Number(id)] || defaultLevel;
export const getNextLevel = id => levels[levelIds.find(nextId => nextId > Number(id))] || null;
