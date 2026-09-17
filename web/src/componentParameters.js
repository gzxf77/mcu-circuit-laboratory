// Shared parameter descriptions for inventory and on-board component menus.
// Values come from the active level and live game state, never duplicated in JSX.
export function componentParameters(id, level, game) {
  const voltage = level.electrical.gpioHighV.toFixed(1);
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
      return { title: '导线', value: '连线工具', detail: '使用画布上方的「连线」按钮，依次点击两个端点。' };
    default:
      return { title: id, value: '参数待定义', detail: '拖入搭建区放置。' };
  }
}

export function componentStatusText(id, componentState) {
  if (!componentState) return null;
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
