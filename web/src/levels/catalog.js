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
    id: 1, model: 'resistor-dc-v1', title: '参考方向与功率', chapter: '第一章 · 电路基础', chapterSubtitle: '谁在吸收，谁在释放',
    story: '12 V 电源、节点 A、GND 和一只 6 mA 电流源都已固定在搭建区。电源经 R1 给节点 A 供电，R2 从节点 A 接地；电流源也接在节点 A 与 GND 之间——它的两个端子由你决定怎么接。让节点 A 稳定在约 3.0 V，然后判断每个元件此刻是在吸收还是在释放功率：注意"源"不一定在供电。',
    concept: '同一节点的 KCL：流入节点 A 的电流等于流出的电流，(12 V − U_A)/R1 与电流源的 6 mA 一起，等于 U_A/R2。功率按参考方向判定：电压与电流为关联参考方向时 P = U·I，非关联时 P = −UI；P > 0 表示吸收，P < 0 表示释放。回路里吸收的功率之和等于释放的功率之和。',
    knowledge: [
      { title: '参考方向', formula: '关联：P = U·I\n非关联：P = −U·I',
        text: '电压极性与电流箭头是人为选定的参考方向。电流从标 + 的端子流入时两者关联，用 P = U·I；从 − 端流入则为非关联，用 P = −U·I。板上电源与电流源的箭头都从 + 端流出，所以是非关联。' },
      { title: '功率的正负', formula: 'P > 0 吸收\nP < 0 释放',
        text: '算出正值说明该元件在吸收功率（把电能变成热或其他形式），负值说明它在释放功率（向外供电）。电阻永远是 P = I²R > 0，只吸收。' },
      { title: '功率守恒', formula: 'ΣP吸收 = ΣP释放',
        text: '整个电路吸收的功率等于释放的功率。本关参考解：电源释放 108 mW，R1 吸收 81 mW、R2 吸收 9 mW、电流源吸收 18 mW（它被外电路充电）。' },
    ],
    initialReversed: false,
    board: { fixedParts: ['power', 'isource', 'nodeA', 'ground'], positions: {
      power: { x: 175, y: 187 }, r1: { x: 345, y: 255 }, nodeA: { x: 493, y: 323 },
      r2: { x: 570, y: 459 }, isource: { x: 175, y: 527 }, ground: { x: 790, y: 527 },
    } },
    circuit: {
      source: 'power', ground: 'ground', nodeA: 'nodeA',
      currentSource: { id: 'isource', out: 'isource.out', in: 'isource.in' },
      // This level needs the source to DRAW current from node A, so wiring it the
      // other way round is a valid answer here, not a reversed-source fault, and
      // the level asks for a power judgement instead.
      currentSourcePolarity: 'either',
      powerJudgement: true,
      defaultProbeTarget: 'nodeA',
      flowLabel: '12 V 电源 → R1 → 节点 A → R2 → GND，6 mA 电流源也接在节点 A 与 GND 之间',
      // Player-facing library shows one generic resistor; each drop takes the next slot.
      resistors: ['r1', 'r2'], resistorSlots: [],
      baseWires: [],
      solutionWires: ['power-r1.a', 'r1.b-nodeA', 'nodeA-r2.a', 'r2.b-ground', 'isource.in-nodeA', 'isource.out-ground'],
    },
    electrical: {
      sourceV: 12, sourceCurrentMa: 6, scopeMaxV: 15,
      resistorOptionsOhms: [470, 1000, 1500, 2000, 2200, 3300, 4700],
      // The defaults deliberately do not solve the level: 1.5 kΩ on both sides
      // puts node A at 1.5 V, so the player has to change the values as well as
      // the wiring. The reference build is R1 = R2 = 1 kΩ → 3.0 V.
      defaultOhms: { r1: 1500, r2: 1500 },
      referenceOhms: { r1: 1000, r2: 1000 },
      resistorRatedPowerW: 0.25,
    },
    parts: [
      { id: 'power', label: '12 V 电源', count: '×1' },
      { id: 'isource', label: '6 mA 电流源', count: '×1' },
      { id: 'nodeA', label: '节点 A', count: '×1' },
      { id: 'resistor', label: '电阻', count: '∞' },
      { id: 'ground', label: 'GND', count: '×1' },
      { id: 'probe', label: '探针', count: '×1' },
    ],
    goals: [
      { id: 'node', label: '让节点 A 稳定在约 3.0 V', when: { all: [
        { metricBetween: { key: 'nodeAV', min: 2.95, max: 3.05 } },
      ] } },
      { id: 'power', label: '判断电源、R1、R2 与电流源各自的吸收/释放', when: { all: [
        { powerJudged: { id: 'power', expect: 'deliver' } },
        { powerJudged: { id: 'r1', expect: 'absorb' } },
        { powerJudged: { id: 'r2', expect: 'absorb' } },
        { powerJudged: { id: 'isource', expect: 'absorb' } },
      ] } },
    ],
  }),
  2: defineLevel({
    id: 2, model: 'resistor-dc-v1', title: '源与受控源', chapter: '第一章 · 电路基础', chapterSubtitle: '输出由控制量决定',
    story: '9 V 电源经 R1 送到节点 A，节点 A 再经 R2 到节点 B、经 R3 回 GND——这是一条两级分压链。另有一只压控电流源：它注入节点 A 的电流是 g·U_B，控制量取节点 B 对 GND 的电压，而 g 由你手上的滑块决定（默认 0.25 mS）。让节点 B 稳定在约 3.6 V，并让受控源输出约 1.8 mA。',
    concept: '受控源不是独立的：它的输出 I = g·U_B 由节点 B 的电压决定，而节点 B 的电压又被这股注入电流抬高，两者互相牵制，要用两个节点的 KCL 联立。节点 B 没有别的支路进出，所以 (U_A − U_B)/R2 = U_B/R3；节点 A 处 (9 V − U_A)/R1 + g·U_B = (U_A − U_B)/R2。代入 R1 = R2 = R3 = 1 kΩ、g = 0.5 mS：U_A = 2U_B，9 = (3 − 1000g)U_B → U_B = 3.6 V、U_A = 7.2 V、受控源输出 1.8 mA。',
    knowledge: [
      { title: '受控源', formula: 'I = g · U控制\ng 单位：S（西门子）',
        text: '压控电流源的输出电流由控制电压决定，不是固定值。控制电压为 0，它的输出就是 0——受控源不能像独立电源那样单独给电路供电。本关控制量取节点 B 的电压。' },
      { title: '两级分压与联立', formula: '(U_A − U_B)/R2 = U_B/R3\n(9 − U_A)/R1 + g·U_B = (U_A − U_B)/R2',
        text: '节点 B 是一条支路的中间点，先由它写出 U_A 与 U_B 的关系（U_A = 2U_B，当 R2 = R3），再代进节点 A 的 KCL，把两个未知量化成一个方程。' },
      { title: '跨导 g 的量纲', formula: 'I = g · U\n[S] = [A]/[V] = 1/Ω',
        text: 'g 的单位是西门子：0.5 mS 就是 0.5 mA/V。g 越大，同一个控制电压产生的注入电流越大；控制电压为 0 时无论 g 多大都没有输出。' },
    ],
    initialReversed: false,
    board: { fixedParts: ['power', 'vccs', 'nodeA', 'nodeB', 'ground'], positions: {
      power: { x: 175, y: 187 }, r1: { x: 345, y: 187 }, nodeA: { x: 493, y: 255 },
      r2: { x: 620, y: 255 }, nodeB: { x: 790, y: 255 }, r3: { x: 620, y: 459 },
      vccs: { x: 175, y: 527 }, ground: { x: 790, y: 527 },
    } },
    circuit: {
      source: 'power', ground: 'ground', nodeA: 'nodeA', nodeB: 'nodeB',
      controlledSource: { id: 'vccs', out: 'vccs.out', in: 'vccs.in', control: { positive: 'nodeB', negative: 'ground' } },
      defaultProbeTarget: 'nodeB',
      flowLabel: '9 V 电源 → R1 → 节点 A → R2 → 节点 B → R3 → GND，受控源按 g·U_B 注入节点 A',
      // Player-facing library shows one generic resistor; each drop takes the next slot.
      resistors: ['r1', 'r2', 'r3'], resistorSlots: [], baseWires: [],
      solutionWires: ['power-r1.a', 'r1.b-nodeA', 'nodeA-r2.a', 'r2.b-nodeB', 'nodeB-r3.a', 'r3.b-ground', 'vccs.out-nodeA', 'vccs.in-ground'],
    },
    electrical: {
      sourceV: 9, controlledTransconductanceMs: 0.5, defaultTransconductanceMs: 0.25,
      gainRangeMs: [0.05, 1, 0.05], scopeMaxV: 10,
      resistorOptionsOhms: [470, 1000, 1500, 2000, 2200, 3300, 4700],
      // Unequal defaults: the values must be equalised as well as g turned to 0.5 mS.
      defaultOhms: { r1: 1500, r2: 1000, r3: 1500 },
      referenceOhms: { r1: 1000, r2: 1000, r3: 1000 },
      resistorRatedPowerW: 0.25,
    },
    parts: [
      { id: 'power', label: '9 V 电源', count: '×1' },
      { id: 'vccs', label: '压控电流源', count: '×1' },
      { id: 'nodeA', label: '节点 A', count: '×1' },
      { id: 'nodeB', label: '节点 B', count: '×1' },
      { id: 'resistor', label: '电阻', count: '∞' },
      { id: 'ground', label: 'GND', count: '×1' },
      { id: 'probe', label: '探针', count: '×1' },
    ],
    goals: [
      { id: 'node', label: '让节点 B 稳定在约 3.6 V', when: { all: [
        { metricBetween: { key: 'nodeBV', min: 3.55, max: 3.65 } },
      ] } },
      { id: 'controlled', label: '让受控源输出约 1.8 mA（g = 0.5 mS × U_B）', when: { all: [
        { metricBetween: { key: 'controlledSourceCurrentMa', min: 1.75, max: 1.85 } },
      ] } },
    ],
  }),
  3: defineLevel({
    id: 3, model: 'resistor-dc-v1', title: '功率预算与供电设计', chapter: '第一章 · 电路基础', chapterSubtitle: '额定值决定器件怎么选',
    story: '12 V 电源要给一只固定的 100 Ω 负载供电，要求负载电压约 3.0 V、负载功率约 90 mW。串联部分由你搭：拖入电阻、接线、选阻值。每只电阻都能选额定功率档位——默认 ¼ W，也可以换成 ½ W。读数要对，器件也不能超过它自己的额定值。',
    concept: '串联部分要吃掉 12 V − 3.0 V = 9.0 V、通过 30 mA，所以等效阻值必须是 300 Ω。同一只 300 Ω 有两种活法：让它独自扛 30 mA，P = I²R = 0.27 W，¼ W 的器件就超限（换成 ½ W 才安全）；或者拆成两只 600 Ω 并联，电流各半，每只只有 0.135 W，¼ W 也够用。选型要同时看功能指标、器件应力、件数与成本。',
    knowledge: [
      { title: '功率与额定值', formula: 'P = I²R = U²/R\nP ≤ P额定（每只器件）',
        text: '每只电阻都有自己的额定功率。先算实际耗散，再和它自己的额定值比较，还要留裕量——读数达标不等于方案可用。' },
      { title: '两条降应力的路', formula: '换大额定值：¼ W → ½ W\n或并联分流：每只 P = I²R等效/n',
        text: '超限时有两条路：换一只额定功率更大的器件，或者把这条支路拆成 n 只等值电阻并联——等效阻值不变，每只只承担 1/n 的电流，功率降到 1/n。' },
      { title: '方案取舍', formula: '功能达标 ∧ 每只 P ≤ P额定',
        text: '同一功能常有多种合格做法：一只 ½ W 的 300 Ω、两只 ¼ W 的 600 Ω 并联都能满足要求，接下来比较件数、成本和裕量。' },
    ],
    initialReversed: false,
    board: { fixedParts: ['power', 'nodeA', 'ground', 'r2'], positions: {
      power: { x: 175, y: 187 }, nodeA: { x: 620, y: 391 }, r2: { x: 790, y: 391 }, ground: { x: 790, y: 593 },
      r1: { x: 310, y: 187 }, r3: { x: 310, y: 289 }, r4: { x: 310, y: 391 },
    } },
    circuit: {
      source: 'power', ground: 'ground', nodeA: 'nodeA',
      // The load is given and fixed; 'load' only names it for the parameter menu.
      load: 'r2',
      defaultProbeTarget: 'nodeA',
      flowLabel: '12 V 电源 →（你搭的串联部分）→ 节点 A → 负载 → GND',
      // Player-facing library shows one generic resistor; each drop takes the next slot.
      resistors: ['r1', 'r2', 'r3'], resistorSlots: [], baseWires: [],
      solutionWires: ['power-r1.a', 'r1.b-nodeA', 'power-r3.a', 'r3.b-nodeA', 'nodeA-r2.a', 'r2.b-ground'],
    },
    electrical: {
      sourceV: 12, loadOhms: 100, scopeMaxV: 14,
      resistorOptionsOhms: [300, 600, 900, 1000, 1500, 2200],
      // The defaults must not hand over the answer: 300 Ω is exactly the equivalent
      // resistance the level is about, so a dropped resistor starts at 1 kΩ.
      defaultOhms: { r1: 1000, r2: 100, r3: 1000 },
      referenceOhms: { r1: 600, r2: 100, r3: 600 },
      // Every resistor can be a ¼ W or a ½ W part: that choice is the level.
      resistorRatedPowerW: 0.25,
      resistorRatingOptionsW: [0.25, 0.5],
    },
    parts: [
      { id: 'power', label: '12 V 电源', count: '×1' },
      { id: 'nodeA', label: '节点 A', count: '×1' },
      { id: 'resistor', label: '电阻', count: '∞' },
      { id: 'ground', label: 'GND', count: '×1' },
      { id: 'probe', label: '探针', count: '×1' },
    ],
    goals: [
      { id: 'node', label: '让节点 A（负载电压）稳定在约 3.0 V', when: { all: [
        { metricBetween: { key: 'nodeAV', min: 2.95, max: 3.05 } },
      ] } },
      { id: 'load', label: '让负载功率达到约 90 mW', when: { all: [
        { metricBetween: { key: 'r2PowerMw', min: 87, max: 93 } },
      ] } },
    ],
  }),
});

export const levelIds = Object.freeze(Object.keys(levels).map(Number).sort((a, b) => a - b));
export const defaultLevel = levels[1];
export const getLevel = id => levels[Number(id)] || defaultLevel;
export const getNextLevel = id => levels[levelIds.find(nextId => nextId > Number(id))] || null;
