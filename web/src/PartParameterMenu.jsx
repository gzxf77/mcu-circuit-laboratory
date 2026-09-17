import { componentParameters, componentStatusText } from './componentParameters.js';
import { useState } from 'react';
import { pointerTrace } from './pointerTrace';

export function PartParameterMenu({ id, level, game, componentState, placement = false, onChooseResistor, onFlipLed, onRemove, onClose, onUseWire }) {
  const info = componentParameters(id, level, game);
  const [optionsOpen, setOptionsOpen] = useState(placement);
  const stateText = placement ? null : componentStatusText(id, componentState);
  return <div className="parameter-menu" role="group" aria-label={info.title + '参数与操作'} onPointerDown={event => { pointerTrace('menu-down', { id, target: event.target.tagName, x: event.clientX, y: event.clientY }); event.stopPropagation(); }} onClick={event => event.stopPropagation()}>
    <div className="parameter-menu-title"><strong>{info.title} · 参数</strong><button type="button" aria-label="关闭元件选单" onClick={onClose}>×</button></div>
    <div className="parameter-value">{info.value}</div>
    {stateText && <div className={'parameter-status ' + (['burned', 'burst', 'overload'].includes(componentState.state) ? 'fault' : '')}>{stateText}</div>}
    {placement && <p>{info.detail}</p>}
    {info.options && optionsOpen && <div className="parameter-options" role="group" aria-label="选择电阻阻值">{info.options.map(ohms => <button key={ohms} type="button" className={(info.selectedOhms ?? game.resistorOhms) === ohms ? 'chosen' : ''} aria-pressed={(info.selectedOhms ?? game.resistorOhms) === ohms} onClick={() => onChooseResistor(id, ohms)}>{ohms} Ω</button>)}</div>}
    <div className="parameter-menu-actions">
      {placement ? <>
        {id === 'wire' && <button type="button" onClick={onUseWire}>启用连线</button>}
        <small>{id === 'wire' ? '按住端点，拖到另一端点松开' : '拖动元件卡片到搭建区放置'}</small>
      </> : <>
        {info.options && <button type="button" onClick={() => setOptionsOpen(!optionsOpen)}>{optionsOpen ? '收起阻值' : '切换阻值'}</button>}
        {id === 'led' && <button type="button" onClick={onFlipLed}>翻转 LED</button>}
        {onRemove && <button type="button" className="remove" onClick={onRemove}>{id === 'wire' ? '删除连接' : '删除元件'}</button>}
      </>}
    </div>
  </div>;
}
