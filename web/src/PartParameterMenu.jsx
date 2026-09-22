import { componentParameters, componentStatusText, powerReferenceText } from './componentParameters.js';
import { useState } from 'react';
import { pointerTrace } from './pointerTrace';

export function PartParameterMenu({ id, level, game, componentState, placement = false, onChooseResistor, onFlipLed, onRemove, onClose, onUseWire, onJudgePower, judgedPower, onJudgeAssoc, judgedAssoc, onJudgeUiMeaning, judgedUiMeaning, onTuneGain, onChooseRating }) {
  const info = componentParameters(id, level, game);
  const [optionsOpen, setOptionsOpen] = useState(placement);
  const stateText = placement ? null : componentStatusText(id, componentState);
  const referenceText = placement || !onJudgePower ? null : powerReferenceText(id, level, componentState);
  return <div className="parameter-menu" role="group" aria-label={info.title + '参数与操作'} onPointerDown={event => { pointerTrace('menu-down', { id, target: event.target.tagName, x: event.clientX, y: event.clientY }); event.stopPropagation(); }} onClick={event => event.stopPropagation()}>
    <div className="parameter-menu-title"><strong>{info.title} · 参数</strong><button type="button" aria-label="关闭元件选单" onClick={onClose}>×</button></div>
    <div className="parameter-value">{info.value}</div>
    {stateText && <div className={'parameter-status ' + (['burned', 'burst', 'overload'].includes(componentState.state) ? 'fault' : '')}>{stateText}</div>}
    {placement && <p>{info.detail}</p>}
    {!placement && info.gain && onTuneGain && <div className="gain-tuner" role="group" aria-label="调节跨导">
      <label htmlFor={'gain-' + id}>{info.gain.label}<strong>{info.gain.value.toFixed(2)} mS</strong></label>
      <input id={'gain-' + id} type="range" min={info.gain.min} max={info.gain.max} step={info.gain.step}
        value={info.gain.value} aria-label="跨导 g，单位毫西"
        onChange={event => onTuneGain(id, Number(event.target.value))} />
      <small>拖动滑块改变跨导：输出电流 I = g·U控制 会随读数实时变化。</small>
    </div>}
    {!placement && onJudgePower && <div className="power-judge" role="group" aria-label="功率判断">
      <div className="power-judge-readings">{referenceText}</div>
      {onJudgeAssoc && <div className="judge-step">
        <span className="judge-q">① 电流 i 从标 + 的端子…</span>
        <div className="power-judge-options">
          <button type="button" className={judgedAssoc === 'in' ? 'chosen' : ''} aria-pressed={judgedAssoc === 'in'} onClick={() => onJudgeAssoc(id, 'in')}>流入（关联）</button>
          <button type="button" className={judgedAssoc === 'out' ? 'chosen' : ''} aria-pressed={judgedAssoc === 'out'} onClick={() => onJudgeAssoc(id, 'out')}>流出（非关联）</button>
        </div>
      </div>}
      {onJudgeUiMeaning && <div className="judge-step">
        <span className="judge-q">② 那么 ui 表示…</span>
        <div className="power-judge-options">
          <button type="button" className={judgedUiMeaning === 'absorb' ? 'chosen' : ''} aria-pressed={judgedUiMeaning === 'absorb'} onClick={() => onJudgeUiMeaning(id, 'absorb')}>吸收功率</button>
          <button type="button" className={judgedUiMeaning === 'deliver' ? 'chosen' : ''} aria-pressed={judgedUiMeaning === 'deliver'} onClick={() => onJudgeUiMeaning(id, 'deliver')}>发出功率</button>
        </div>
      </div>}
      <div className="judge-step">
        <span className="judge-q">③ 按真实符号，它实际…</span>
        <div className="power-judge-options">
          <button type="button" className={judgedPower === 'absorb' ? 'chosen' : ''} aria-pressed={judgedPower === 'absorb'} onClick={() => onJudgePower(id, 'absorb')}>吸收功率</button>
          <button type="button" className={judgedPower === 'deliver' ? 'chosen' : ''} aria-pressed={judgedPower === 'deliver'} onClick={() => onJudgePower(id, 'deliver')}>发出功率</button>
        </div>
      </div>
      <small>关联（电流从 + 端流入）：P = U·I，P&gt;0 吸收；非关联（从 + 端流出）：P = −U·I。先定参考方向，再看真实符号。</small>
    </div>}
    {info.ratings && onChooseRating && <div className="parameter-ratings" role="group" aria-label="选择额定功率">
      <span>{info.ratings.label}</span>
      {info.ratings.options.map(watts => <button key={watts} type="button"
        className={Math.abs((info.ratings.value ?? 0) - watts) < 1e-9 ? 'chosen' : ''}
        aria-pressed={Math.abs((info.ratings.value ?? 0) - watts) < 1e-9}
        onClick={() => onChooseRating(id, watts)}>{(watts * 1000).toFixed(0)} mW</button>)}
    </div>}
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
