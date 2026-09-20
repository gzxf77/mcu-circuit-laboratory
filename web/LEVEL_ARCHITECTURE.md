# 数据驱动关卡架构

页面从 URL 的 `level` 参数选择配置；当前制作了课程版第 1 关「分流节点」、第 2 关「分流支路」与第 3 关「双源供电」。三关共用 `resistor-dc-v1` 直流电阻网络模型：第 1 关由理想电压源固定节点电压，第 2 关由理想电流源固定注入电流，第 3 关让两者同时作用（压源定 U、流源定 I），分别报告 `voltageSourceCurrentMa` 与 `currentSourceVoltageV`。早期 GPIO—电阻—LED 模型保留为未上架的可复用关卡族。以后真正不同的电路可在关卡目录增加配置，同一类电路继续共用模型与交互。

| 层 | 文件 | 职责 |
| --- | --- | --- |
| 关卡目录 | `src/levels/catalog.js` | 标题、叙事、候选元件值、初始状态、目标接线、自由实验建议与电气参数 |
| 配置校验 | `src/levels/defineLevel.js` | 校验元件、端点、阻值候选、参考解及声明式目标条件 |
| 元件目录 | `src/componentCatalog.js`、`src/componentParameters.js` | 端点几何、吸附边界和参数说明；新增元件时注册一次 |
| 目标规则 | `src/engine/goalRules.js` | 解释放置、连接、数值范围、安全状态与探针测点等条件 |
| 电路模型 | `src/resistiveNetwork.js`、`src/evaluateCircuit.js`、`src/currentPaths.js`、`src/probeModel.js` | 分别求解通用直流电阻网络（电压源或电流源）、调度关卡模型、保留旧 LED 路径模型和生成探针读数 |
| 元件状态 | `src/componentStates.js` | 从同一电气结果导出每个元件的状态和显示参数；新元件类型注册一次状态规则 |
| 共用界面 | `src/App.jsx`、`src/CircuitBoard.jsx`、`src/PartParameterMenu.jsx` | 元件库参数选单、拖入放置、板上就地选单、探针、目标与结算 |

## 配置一个同类关卡

第 1 关（重建版）同时声明 `circuit.source`（12 V）与 `circuit.currentSource`（6 mA），并打开两个关卡级开关：`circuit.currentSourcePolarity: 'either'` 表示电流源接反在这一关是合法接法（它让源吸收功率，正是本关要教的），`circuit.powerJudgement: true` 表示判题里含**判断类目标**。目标为 ① 节点 A ≈ 3.0 V ② `powerJudged` 逐只元件判断吸收/释放；判断规则要求「玩家选择 = 目标」且「电路真实符号 = 目标」，所以猜对但电路搭错不算通过。参考解 R1 = R2 = 1 kΩ：节点 3.0 V，元件功率 −108 / +81 / +9 / +18 mW。求解器为此报告 `network.elementPowerMw`（每个元件带符号功率，吸收为正）。

第 3 关同时声明 `circuit.source`（+ `sourceV`）与 `circuit.currentSource`（+ `sourceCurrentMa`）：9 V 电压源经 R1 供电、3 mA 电流源注入节点 A、R2 从 A 接地，目标是节点 A ≈ 6.0 V、电压源输出 ≈ 3.0 mA、电流源端电压 ≈ 6.0 V；判题只用 `metricBetween` 读电气指标，因此复合阻值（2 kΩ∥2 kΩ 当 1 kΩ）等不同接法同样合格。

第 2 关（重建版）采用 `resistor-dc-v1` 的 `circuit.controlledSource`、`circuit.nodeB` 与 `electrical.controlledTransconductanceMs` / `defaultTransconductanceMs` / `gainRangeMs`；两级分压链的中间点用 `circuit.nodeB` 命名，求解器同时报告 `nodeBV`。g 可以在运行时由玩家的滑块改写（`game.controlledGmMs`，求解器优先用它，`controlledTransconductanceMs` 是参考值）：`controlledSource` 声明流出端、流回端和控制量的两个端点，求解器把输出电流 g·(V控制+ − V控制−) 作为**含未知量的项**移进节点方程的左边（`controlledSourceCurrentMa`、`controlledSourceControlV` 是它的两个读数）。它只在自身回路闭合、且控制支路接到参考节点时才输出，控制量为 0 就没有输出——受控源不能独立激励。参考解为 9 V 电源 → R1 = 2 kΩ → 节点 A → R2 = 1 kΩ → GND，g = 0.5 mS：节点 A 4.5 V、受控源输出 2.25 mA、电压源输出 2.25 mA。第一版只做压控型；流控源需要支路电流未知量（MNA），留到第 4 章。三关都只声明元件、接线、候选阻值、参考解和数值目标；`referenceOhms` 只用于参考解和测试态，玩家开局使用不同的默认阻值。

第 3 关是**自由搭建 + 器件档位**关卡：玩家照常拖电阻、接线，但每只电阻多了一个 `game.resistorRatings[id]`（额定功率，档位由 `electrical.resistorRatingOptionsW` 给出，默认 `resistorRatedPowerW`）。求解器在 `resistorResults[id].ratedPowerW` 上报每只器件自己的额定值，过载判定、元件状态与「查看答案」的参考取值都读它，所以同一只 300 Ω 既可以选择 ½ W 器件、也可以拆成两只 ¼ W 并联。关卡数据里 `circuit.load` 命名被供电的固定负载（`board.fixedParts` 可以固定已声明的电阻，参数菜单对它只显示数值）。

`resistiveNetwork.js` 根据导线连接归并节点，再按 KCL 组装节点方程：电压源作为已知节点电压、电流源作为已知节点注入电流；一个关卡可以只声明其中一个，也可以两个同时声明（第 3 关），此时每类源各自报告「由外电路决定」的那个量（电压源的输出电流、电流源的端电压），两者都支持任意电阻接线，并统一给出节点电压、每只电阻的电流与功率、KCL 误差和等效电阻。电流源只有在回路闭合到 GND 时才注入电流，因此开路时不会凭空产生读数，两端短接时报告不可解。判题条件（`metricBetween`、`networkSafe`、`probeAt` 等）继续在 `engine/goalRules.js` 中解释。

早期 `makeGpioLedLevel` 模板仍支持固定电阻或候选阻值，供以后 LED/MCU 章节使用。例如：

```js
makeGpioLedLevel({
  id: 6,
  title: '示例标题',
  chapter: '后续章节 · MCU 输出',
  chapterSubtitle: 'GPIO 与 LED',
  story: '给玩家的任务描述',
  voltageV: 3.3,
  ledForwardV: 2.0,
  resistorOptionsOhms: [220, 330, 470],
  warningCurrentMa: 20,
  resistorRatedPowerW: 0.25,
  ledVisualFullScaleMa: 15,
  concept: '只写算法概念，不列出候选值的计算结果。',
})
```

旧 LED 模板还可配置 `initialReversed`、`minimumCurrentMa`、`measurement` 和 `experiments`。`ledVisualFullScaleMa` 只决定画面亮度的归一化参考值，不代表 LED 额定电流。若引入全新器件或 MCU 外设行为，先添加一次可复用的元件图形、端点、电气模型与状态规则，再用配置生成后续关卡。现有模型都是教学简化模型，不是通用 SPICE 或固件仿真器。

早期第 2 关是「隐藏开路/短路故障 + 点击标记」的诊断题型，现已连同 `hiddenOpenCandidates`、`hiddenShortCandidates`、`suspectedWires` 与相关界面分支一起从代码和关卡目录移除。误接导致的开路、短路、反接与过载仍由 `evaluateCircuit.js` 分类反馈，但不再有故障注入关卡。
