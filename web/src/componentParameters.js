// Shared parameter descriptions for inventory and on-board component menus.
// Values come from the active level and live game state, never duplicated in JSX.
export function componentParameters(id, level, game) {
  if (level.model === 'resistor-dc-v1') {
    if (/^r\d+$/.test(id)) return {
      title: id.toUpperCase() + ' 电阻',
      value: game.resistorValues?.[id] ? game.resistorValues[id] + ' Ω' : '尚未选择阻值',
      detail: level.concept,
      options: level.electrical.resistorOptionsOhms,
      selectedOhms: game.resistorValues?.[id] ?? null,
    };
    if (id === 'power') return { title: '直流电源', value: level.electrical.sourceV.toFixed(1) + ' V（固定）', detail: '相对 GND 提供稳定的直流电压。' };
    if (id === 'ground') return { title: 'GND', value: '0 V 参考点', detail: '所有节点电压均相对 GND 测量。' };
    if (id === 'nodeA') return { title: '节点 A', value: '待测节点（固定）', detail: 'R1 的输出端与 R2、R3 的输入端都应接到这里；由理想导线连通的端点属于同一节点。' };
    if (id === 'probe') return { title: '探针', value: '节点电压 + 支路电流估算', detail: '拖入搭建区，接触端点或导线查看读数。' };
    if (id === 'wire') return { title: '导线', value: '连线工具', detail: '按住一个端点，拖到另一个端点后松开。' };
  }
  const voltage = level.electrical.gpioHighV ? level.electrical.gpioHighV.toFixed(1) : '0';
  const ledDrop = level.electrical.ledForwardV.toFixed(1);
  switch (id) {
    case 'mcu':
      return { title: 'MCU', value: 'GPIO0 高电平约 ' + voltage + ' V', detail: 'VDD 接电源、GND 接地后，GPIO0 才能按本关模型输出高电平。' };
    case 'power':
      return { title: '电源', value: voltage + ' V（本关固定）', detail: '给 MCU 的 VDD 供电。' };
    case 'ground':
      return { title: 'GND', value: '0 V 参考点', detail: '电压读数以 GND 为参考。' };
    case 'resistor':
      return {
        title: '限流电阻', value: game.resistorOhms ? game.resistorOhms + ' Ω' : '尚未选择阻值',
        detail: level.concept || '电阻串在 GPIO0 与 LED 之间，用于限制支路电流。',
        options: level.electrical.resistorOptionsOhms || null,
      };
    case 'led':
      return { title: 'LED', value: '正向压降约 ' + ledDrop + ' V', detail: '当前阳极在' + (game.reversed ? '右侧' : '左侧') + '；放到画布后可点击翻转方向。' };
    case 'probe':
      return { title: '探针', value: '电压 + 支路电流估算', detail: '拖入搭建区，再拖动探针手柄接触端点或导线。' };
    case 'wire':
      return { title: '导线', value: '连线工具', detail: '使用画布上方的「连线」按钮，按住一个端点，拖到另一个端点后松开。' };
    default:
      return { title: id, value: '参数待定义', detail: '拖入搭建区放置。' };
  }
}

export function componentStatusText(id, componentState) {
  if (!componentState) return null;
  if (/^r\d+$/.test(id)) {
    if (componentState.state === 'overload') return '功率超限 · ' + componentState.powerW.toFixed(3) + ' W';
    if (componentState.state === 'conducting') return '通电 · ' + componentState.currentMa.toFixed(2) + ' mA · 耗散 ' + componentState.powerW.toFixed(3) + ' W';
    return '未通电';
  }
  if (id === 'resistor') {
    if (componentState.state === 'burst') return '功率超限 · 爆裂演示';
    if (componentState.state === 'conducting') {
      return '通电 · 约 ' + componentState.currentMa.toFixed(1) + ' mA · 耗散 ' + componentState.powerW.toFixed(3) + ' W';
    }
    return '未通电';
  }
  if (id === 'led') {
    if (componentState.state === 'burned') return '过流失效';
    if (componentState.state === 'lit') return '正在发光 · 支路约 ' + componentState.currentMa.toFixed(1) + ' mA';
    return '未点亮';
  }
  return null;
}
