# 数据驱动关卡架构

页面从 URL 的 `level` 参数选择配置；当前只制作课程版第 1 关「分流节点」。它使用直流电阻网络模型，早期 GPIO—电阻—LED 模型保留为未上架的可复用关卡族。以后真正不同的电路可在关卡目录增加配置，同一类电路继续共用模型与交互。

| 层 | 文件 | 职责 |
| --- | --- | --- |
| 关卡目录 | `src/levels/catalog.js` | 标题、叙事、候选元件值、初始状态、目标接线、自由实验建议与电气参数 |
| 配置校验 | `src/levels/defineLevel.js` | 校验元件、端点、阻值候选、参考解及声明式目标条件 |
| 元件目录 | `src/componentCatalog.js`、`src/componentParameters.js` | 端点几何、吸附边界和参数说明；新增元件时注册一次 |
| 目标规则 | `src/engine/goalRules.js` | 解释放置、连接、数值范围、安全状态与探针测点等条件 |
| 电路模型 | `src/resistiveNetwork.js`、`src/evaluateCircuit.js`、`src/currentPaths.js`、`src/probeModel.js` | 分别求解通用直流电阻网络、调度关卡模型、保留旧 LED 路径模型和生成探针读数 |
| 元件状态 | `src/componentStates.js` | 从同一电气结果导出每个元件的状态和显示参数；新元件类型注册一次状态规则 |
| 共用界面 | `src/App.jsx`、`src/CircuitBoard.jsx`、`src/PartParameterMenu.jsx` | 元件库参数选单、拖入放置、板上就地选单、探针、目标与结算 |

## 配置一个同类关卡

当前第 1 关采用 `resistor-dc-v1`，配置电源、接地、多个电阻、各自候选值、参考解和数值目标。`resistiveNetwork.js` 根据导线连接归并节点，再按 KCL 求节点电压、每只电阻的电流与功率；它不依赖固定接线顺序。关卡数据中的 `referenceOhms` 只用于参考解和测试态，玩家开局仍需逐只选值。增加同族关卡时应复用求解器，按目标电路增添元件实例与配置。

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

旧 LED 模板还可配置 `initialReversed`、`minimumCurrentMa`、`measurement` 和 `experiments`。`ledVisualFullScaleMa` 只决定画面亮度的归一化参考值，不代表 LED 额定电流。若引入全新器件或 MCU 外设行为，先添加一次可复用的元件图形、端点、电气模型与状态规则，再用配置生成后续关卡。现有两个模型都是教学简化模型，不是通用 SPICE 或固件仿真器。
