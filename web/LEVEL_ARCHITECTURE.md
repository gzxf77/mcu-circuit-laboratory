# 数据驱动关卡架构

页面从 URL 的 `level` 参数选择配置；当前只制作第 1 关。原第 2–5 关的阻值、极性和测量练习已合并进同一关的自由实验。以后真正不同的电路可以在关卡目录增加配置，同一类电路继续共用模型与交互。

| 层 | 文件 | 职责 |
| --- | --- | --- |
| 关卡目录 | `src/levels/catalog.js` | 标题、叙事、候选元件值、初始状态、目标接线、自由实验建议与电气参数 |
| 配置校验 | `src/levels/defineLevel.js` | 校验元件、端点、阻值候选、目标电流范围及声明式目标条件 |
| 元件目录 | `src/componentCatalog.js`、`src/componentParameters.js` | 端点几何、吸附边界和参数说明；新增元件时注册一次 |
| 目标规则 | `src/engine/goalRules.js` | 解释放置、连线、LED 方向、电流范围与探针测点等条件 |
| 电路模型 | `src/evaluateCircuit.js`、`src/currentPaths.js`、`src/probeModel.js` | 计算通路、故障、电流、电压与波形 |
| 元件状态 | `src/componentStates.js` | 从同一电气结果导出每个元件的状态和显示参数；新元件类型注册一次状态规则 |
| 共用界面 | `src/App.jsx`、`src/CircuitBoard.jsx`、`src/PartParameterMenu.jsx` | 元件库参数选单、拖入放置、板上就地选单、探针、目标与结算 |

## 配置一个同类关卡

`makeGpioLedLevel` 可以指定固定电阻，也可以传入候选阻值。第 1 关采用 `resistorOptionsOhms`，开局没有默认阻值；玩家点元件库中的电阻选值，再拖入画布。已放置的电阻也能通过它下方的选单换值。程序用同一电路模型实时重算。

```js
makeGpioLedLevel({
  id: 6,
  title: '示例标题',
  chapter: '第一章 · 数字输出',
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

同类关卡还可配置 `initialReversed`、`minimumCurrentMa`、`measurement` 和 `experiments`。`ledVisualFullScaleMa` 只决定画面亮度的归一化参考值，不代表 LED 额定电流；电阻爆裂效果由计算功率超过 `resistorRatedPowerW` 触发，是教学可视化。若引入全新拓扑、器件或 MCU 外设行为，先添加一次可复用的元件图形、端点、电气模型与状态规则，再用配置生成该类型的后续关卡。当前 `gpio-led-series-v1` 是教学简化模型，不是通用 SPICE 或固件仿真器。
