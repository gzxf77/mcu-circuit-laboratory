// Shared parameter descriptions for inventory and on-board component menus.
// Values come from the active level and live game state, never duplicated in JSX.
export function componentParameters(id, level, game) {
  if (level.model === 'resistor-dc-v1') {
    if (level.circuit.load === id) return {
      title: '负载 ' + id.toUpperCase(),
      value: game.resistorValues?.[id] ? game.resistorValues[id] + ' Ω（固定）' : '尚未给定阻值',
      detail: '本关要供电的对象：要求它两端约 3.0 V、耗散约 90 mW。它的阻值由题设固定，不能更换。',
    };
    if (/^r\d+$/.test(id)) {
      // A fixed resistor shows its value only: no invented choices.
      const fixed = Boolean(level.board.fixedParts?.includes(id));
      const ratingOptions = level.electrical.resistorRatingOptionsW || null;
      const rating = game.resistorRatings?.[id] ?? level.electrical.resistorRatedPowerW;
      const watts = value => (value * 1000).toFixed(0) + ' mW（' + (value === 0.25 ? '¼ W' : value === 0.5 ? '½ W' : value + ' W') + '）';
      return {
        title: id.toUpperCase() + ' 电阻' + (fixed ? '（固定）' : ''),
        value: (game.resistorValues?.[id] ? game.resistorValues[id] + ' Ω' : '尚未选择阻值')
          + (ratingOptions ? ' · ' + watts(rating) : ''),
        detail: level.concept,
        options: fixed ? null : level.electrical.resistorOptionsOhms,
        selectedOhms: game.resistorValues?.[id] ?? null,
        // The rated power is a real design choice, not a constant.
        ratings: !fixed && ratingOptions ? { label: '额定功率', value: rating, options: ratingOptions } : null,
      };
    }
    if (id === 'power') return { title: '直流电源', value: level.electrical.sourceV.toFixed(1) + ' V（固定）', detail: '相对 GND 提供稳定的直流电压。' };
    if (id === 'isource') return { title: '理想电流源', value: level.electrical.sourceCurrentMa.toFixed(1) + ' mA（固定）', detail: '输出电流恒定，两端电压由外电路（并联支路）决定：负载越大，端电压越高。' };
    if (id === 'vccs') {
      const gain = game.controlledGmMs ?? level.electrical.controlledTransconductanceMs;
      const control = level.circuit.controlledSource?.control;
      const controlName = control
        ? (control.positive === 'nodeB' ? '节点 B' : control.positive === 'nodeA' ? '节点 A' : control.positive) + ' 对 GND 的电压'
        : '控制电压';
      return {
        title: '压控电流源',
        value: 'g = ' + Number(gain).toFixed(2) + ' mS（本关可调）',
        detail: '输出电流由控制电压决定：I = g·U控制，本关的控制量是' + controlName
          + '。控制电压为 0 时它不输出电流——受控源不能独立激励电路。',
        gain: {
          value: Number(gain),
          min: level.electrical.gainRangeMs?.[0] ?? 0.05,
          max: level.electrical.gainRangeMs?.[1] ?? 1,
          step: level.electrical.gainRangeMs?.[2] ?? 0.05,
          label: '跨导 g',
        },
      };
    }
    if (id === 'ground') return { title: 'GND', value: '0 V 参考点', detail: '所有节点电压均相对 GND 测量。' };
    if (id === 'nodeA') return { title: '节点 A', value: '待测节点（固定）', detail: '各支路的公共节点；由理想导线连通的端点属于同一节点。' };
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

// The two readings a player needs to judge absorbed vs delivered power: the
// element's voltage and current in the reference direction the board draws, plus
// whether those two directions are associated (P = U·I) or not (P = −U·I).
export function powerReferenceText(id, level, componentState) {
  const reference = componentState?.reference;
  if (!reference) return null;
  const sign = value => (value >= 0 ? '+' : '') + value.toFixed(2);
  const voltage = Number.isFinite(reference.voltageV) ? sign(reference.voltageV) + ' V' : '未求解';
  const current = Number.isFinite(reference.currentMa) ? sign(reference.currentMa) + ' mA' : '未求解';
  const shape = reference.associated ? 'U(a→b)、I(a→b)' : 'U(标 + 的端子在前)、I(从 + 端流出)';
  const convention = reference.associated ? '关联参考方向：P = U·I' : '非关联参考方向：P = −U·I';
  return shape + '：' + voltage + ' · ' + current + ' · ' + convention;
}

export function componentStatusText(id, componentState) {
  if (!componentState) return null;
  if (id === 'isource') {
    if (componentState.state === 'shorted') return '两端短接 · 停止求解';
    if (componentState.state === 'open') return '回路未闭合 · 等待接线';
    return '输出 ' + componentState.currentMa.toFixed(2) + ' mA 恒定'
      + (Number.isFinite(componentState.voltageV) ? ' · 端电压 ' + componentState.voltageV.toFixed(2) + ' V' : '');
  }
  if (id === 'vccs') {
    if (componentState.state === 'open') return '控制支路或回路未闭合 · 输出为 0（受控源不能独立激励）';
    return '输出 ' + componentState.currentMa.toFixed(2) + ' mA = g·U控制 = '
      + componentState.gmMs + ' mS × ' + (Number.isFinite(componentState.controlV) ? componentState.controlV.toFixed(2) : '—') + ' V';
  }
  if (/^r\d+$/.test(id)) {
    if (componentState.state === 'overload') {
      return '功率超限 · ' + (componentState.powerW * 1000).toFixed(0) + ' mW / 额定 '
        + ((componentState.ratedPowerW ?? 0.25) * 1000).toFixed(0) + ' mW';
    }
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
