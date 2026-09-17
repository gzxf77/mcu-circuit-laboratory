# 电路实验室

面向电子信息与自动化专业初学者的 MCU 电路学习游戏原型。玩家从空白搭建区拖入元件、选择参数并连接端点，实时观察电流方向、LED 亮度、探针读数、波形和关卡目标。

当前实现第 1 关“点亮信号灯”。关卡内容与电气参数采用数据配置，元件状态、连线、探针及结果界面由通用代码处理。

## 本地运行

```bash
cd web
npm ci
npm run dev
```

打开终端输出的本地地址。验证命令：`npm run test:circuit`、`npm run test:sites`、`npm run build`。

实现说明见 [web/README.md](web/README.md) 与 [web/LEVEL_ARCHITECTURE.md](web/LEVEL_ARCHITECTURE.md)；关卡规划见 [课程与关卡蓝图.md](课程与关卡蓝图.md)。界面概念图位于 `assets/`。
