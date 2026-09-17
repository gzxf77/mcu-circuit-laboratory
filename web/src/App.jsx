import { useEffect, useRef, useState } from 'react';
import {
  ArrowCounterClockwise, BookOpen, CaretDown, Check, Circuitry, Cpu,
  GearSix, HandTap, Info, Lightbulb, LightbulbFilament,
  LinkSimple, MagnifyingGlassPlus, Plus, Power, Target,
  Trophy, WarningOctagon, Waveform, X
} from '@phosphor-icons/react';
import { CircuitBoard } from './CircuitBoard';
import { clientPointInSvg, pinPosition, snapComponentPosition, snapProbe } from './circuitGeometry';
import { evaluateCircuit, normalizeWire, startGame, wireKey } from './evaluateCircuit';
import { getLevel, getNextLevel, levelIds } from './levels/catalog';
import { defaultProbe, readProbe } from './probeModel';
import { PartParameterMenu } from './PartParameterMenu';
import { pointerTrace } from './pointerTrace';

const partIcons = { mcu: Cpu, led: Lightbulb, power: Power, wire: LinkSimple };
function Icon({ icon: Component, size = 20, weight = 'regular', ...props }) {
  return <Component size={size} weight={weight} aria-hidden="true" {...props} />;
}
function InventoryIcon({ id }) {
  if (id === 'resistor' || /^r\d+$/.test(id)) return <svg className="inventory-symbol resistor-symbol" viewBox="0 0 40 40" aria-hidden="true">
    <path className="symbol-lead" d="M2 20h7m22 0h7" /><rect x="9" y="14" width="22" height="12" rx="2" />
    <path className="symbol-bands" d="M15 15v10m5-10v10m5-10v10" />
  </svg>;
  if (id === 'ground') return <svg className="inventory-symbol ground-symbol" viewBox="0 0 40 40" aria-hidden="true">
    <path d="M20 5v14M7 19h26M12 25h16m-11 6h6" />
  </svg>;
  if (id === 'probe') return <svg className="inventory-symbol probe-symbol" viewBox="0 0 40 40" aria-hidden="true">
    <path className="probe-cable" d="M28 8c5-1 8 2 8 6v10" /><path className="probe-body" d="M11 27 25 13l5 5-14 14z" />
    <path className="probe-tip-line" d="m11 27-7 9 12-4" /><path className="probe-grip-line" d="m20 18 5 5" />
  </svg>;
  return <Icon icon={partIcons[id]} size={35} weight="duotone" />;
}
function Scope({ reading, level }) {
  const { waveform, voltageV } = reading;
  const hasTrace = waveform === 'step' || waveform === 'flat';
  const supplyV = level.electrical.sourceV ?? level.electrical.gpioHighV;
  const maxV = Math.max(4, Math.ceil(supplyV * 1.2));
  const traceY = voltageV === 0 ? 156 : Math.round(158 - voltageV / maxV * 120);
  const trace = waveform === 'step' ? 'M36 156H90V' + traceY + 'H306' : 'M36 ' + traceY + 'H306';
  return <div className="scope">
    <div className="scope-readout"><strong>{reading.pointLabel}</strong><small>探针读数</small></div>
    <div className="scope-metrics"><div><small>电压</small><strong>{reading.voltageLabel}</strong></div><div><small>支路电流</small><strong>{reading.currentLabel}</strong></div></div>
    <span>{reading.detail}</span><small className="scope-current-detail">{reading.currentDetail}</small>
    <svg viewBox="0 0 318 205" role="img" aria-label={reading.pointLabel + '：电压 ' + reading.voltageLabel + '，电流 ' + reading.currentLabel + '。' + reading.detail}>
      <g className="scope-grid">
        {[38, 59, 98, 158].map(y => <line key={'h' + y} x1="36" y1={y} x2="306" y2={y} />)}
        {[36, 90, 144, 198, 252, 306].map(x => <line key={'v' + x} x1={x} y1="38" x2={x} y2="158" />)}
      </g>
      <path className="scope-axis" d="M36 38v120h270" />
      <path className="scope-guide" d="M36 59h270" />
      {hasTrace && <path className="scope-trace" d={trace} />}
      {!hasTrace && <text className="scope-unknown" x="171" y="107" textAnchor="middle">{waveform === 'idle' ? '等待探针' : reading.voltageLabel}</text>}
      <g className="scope-labels">
        <text x="4" y="162">0</text><text x="4" y="102">{(maxV / 2).toFixed(1)}</text><text x="4" y="63">{supplyV.toFixed(1)}</text><text x="4" y="42">{maxV.toFixed(1)}</text>
        <text x="32" y="182">0</text><text x="84" y="182">10</text><text x="138" y="182">20</text><text x="192" y="182">30</text><text x="246" y="182">40</text><text x="297" y="182">50</text>
        <text x="158" y="203">时间 (ms)</text>
      </g>
    </svg>
  </div>;
}
export function App() {
  const [level] = useState(() => getLevel(new URLSearchParams(window.location.search).get('level')));
  const [clearedLevels, setClearedLevels] = useState(() => {
    try {
      const stored = JSON.parse(window.localStorage.getItem('circuit-cleared-curriculum-v1') || '[]');
      return Array.isArray(stored) ? stored.filter(Number.isInteger) : [];
    }
    catch { return []; }
  });
  const [game, setGame] = useState(() => startGame(false, level));
  const [probe, setProbe] = useState(null);
  const [failureOpen, setFailureOpen] = useState(false);
  const [successOpen, setSuccessOpen] = useState(false);
  const [mode, setMode] = useState('wire');
  const [pending, setPending] = useState(null);
  const [selected, setSelected] = useState(null);
  const [inventoryPart, setInventoryPart] = useState(null);
  const [dragPreview, setDragPreview] = useState(null);
  const [hintOpen, setHintOpen] = useState(true);
  const [zoom, setZoom] = useState(100);
  const [notice, setNotice] = useState('');
  const history = useRef([]);
  const inventoryDrag = useRef(null);
  const suppressInventoryClick = useRef(false);
  const timer = useRef(null);
  const failureTimer = useRef(null);
  const dialogRef = useRef(null);
  const previousFocus = useRef(null);
  const report = evaluateCircuit(game, level, probe);
  const burned = report.ledState === 'burned';
  const checks = report.checks;
  const probeReading = readProbe(game, report, probe, level);
  const levelNumber = String(level.id).padStart(3, '0');
  const progressPercent = Math.round(clearedLevels.filter(id => levelIds.includes(id)).length / levelIds.length * 100);
  const routeStart = Math.max(0, Math.min(levelIds.indexOf(level.id) - 3, levelIds.length - 7));
  const routeLevels = levelIds.slice(routeStart, routeStart + 7);
  const nextLevel = getNextLevel(level.id);
  const requiredPartNames = level.parts.filter(part => !['wire', 'probe'].includes(part.id) && !level.board.fixedParts?.includes(part.id)).map(part => part.label).join('、');
  const clearRunTimers = () => clearTimeout(failureTimer.current);
  const goToLevel = id => {
    const url = new URL(window.location.href);
    url.searchParams.set('level', String(id));
    window.location.assign(url);
  };
  const notify = (message) => {
    clearTimeout(timer.current);
    setNotice(message);
    timer.current = setTimeout(() => setNotice(''), 3000);
  };
  const selectBoard = id => { pointerTrace('selection', { from: selected, to: id }); setInventoryPart(null); setSelected(id); };
  const inspectInventory = id => { setSelected(null); setInventoryPart(current => current === id ? null : id); };
  const updateGame = (next) => {
    clearRunTimers();
    history.current.push({ game: structuredClone(game), probe: probe && { ...probe } });
    setGame(next);
    setProbe(current => current?.target && !next.placed[current.target.split('.')[0]]
      ? { ...current, target: null, wire: null }
      : current?.wire && !next.wires.some(wire => normalizeWire(wire) === current.wire)
        ? { ...current, target: null, wire: null } : current);
    setSelected(null);
    setFailureOpen(false);
    setSuccessOpen(false);
  };
  const addPart = (id, position) => {
    pointerTrace('place-request', { id, position, alreadyPlaced: !!game.placed[id] });
    if (!position) return;
    if (level.board.fixedParts?.includes(id)) return;
    if (id === 'wire') { setMode('wire'); notify('按住一个端点，拖到另一个端点后松开即可连线。'); return; }
    if ((id === 'resistor' && !game.resistorOhms) || (level.model === 'resistor-dc-v1' && level.circuit.resistors.includes(id) && !game.resistorValues?.[id])) {
      setInventoryPart(id);
      notify('请先点选电阻并选择阻值，再拖入搭建区。');
      return;
    }
    if (id === 'probe') {
      setMode('wire');
      if (!probe) {
        history.current.push({ game: structuredClone(game), probe: null });
        setProbe(snapProbe(game, position || defaultProbe));
      } else if (position) setProbe(snapProbe(game, position));
      notify('探针已放置，仍可继续连线；拖动探针手柄即可测量。');
      setInventoryPart(null);
      return;
    }
    if (game.placed[id]) { notify('画布上已有该元件，可拖动它调整位置。'); return; }
    updateGame({
      ...game,
      placed: { ...game.placed, [id]: true },
      positions: { ...game.positions, [id]: snapComponentPosition(id, position || game.positions[id]) },
    });
    pointerTrace('place-committed', { id, position: snapComponentPosition(id, position || game.positions[id]) });
    setInventoryPart(null);
    notify((level.parts.find(part => part.id === id)?.label || '元件') + ' 已放置。拖动端点连线。');
  };
  const startInventoryDrag = (event, id) => {
    if (event.button !== 0 || id === 'wire') return;
    suppressInventoryClick.current = false;
    inventoryDrag.current = { id, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
    pointerTrace('inventory-pointer-down', { id, pointerId: event.pointerId, captured: event.currentTarget.hasPointerCapture(event.pointerId) });
  };
  const moveInventoryDrag = event => {
    const drag = inventoryDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 6) return;
    if (!drag.moved) {
      drag.moved = true;
      setInventoryPart(null);
      pointerTrace('inventory-move-start', { id: drag.id, pointerId: drag.pointerId });
    }
    setDragPreview({ id: drag.id, x: event.clientX, y: event.clientY });
  };
  const finishInventoryDrag = (event, cancelled = false) => {
    const drag = inventoryDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    inventoryDrag.current = null;
    setDragPreview(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const target = cancelled ? null : document.elementFromPoint(event.clientX, event.clientY);
    const board = target?.closest('.board-stage');
    pointerTrace(cancelled ? 'inventory-pointer-cancel' : 'inventory-pointer-up', { id: drag.id, moved: drag.moved, x: event.clientX, y: event.clientY, overBoard: !!board });
    if (!drag.moved || cancelled) return;
    suppressInventoryClick.current = true;
    if (!board) return;
    const svg = board.querySelector('.circuit-board');
    if (!svg) return;
    const point = clientPointInSvg({ x: event.clientX, y: event.clientY }, svg.getBoundingClientRect(), svg.viewBox.baseVal);
    pointerTrace('inventory-place', { id: drag.id, point });
    addPart(drag.id, { x: Math.round(point.x), y: Math.round(point.y) });
  };
  const connect = (from, to) => {
    // Keyboard users can select two focused terminals with Enter or Space.
    if (!to && !pending) { setPending(from); return; }
    const start = to ? from : pending;
    const end = to || from;
    if (end === start) { setPending(null); return; }
    if (end.split('.')[0] === start.split('.')[0]) { notify('请连接到另一个元件的端点。'); setPending(null); return; }
    const key = wireKey(start, end);
    if (game.wires.some(wire => normalizeWire(wire) === key)) { notify('这两个端点已经连接。'); setPending(null); return; }
    updateGame({ ...game, wires: [...game.wires, start + '-' + end] });
    setPending(null);
    notify('导线已连接。');
  };
  const reset = () => {
    clearRunTimers();
    history.current.push({ game: structuredClone(game), probe: probe && { ...probe } });
    setGame(startGame(false, level));
    setProbe(null);
    setMode('wire');
    setPending(null);
    setSelected(null);
    setInventoryPart(null);
    setFailureOpen(false);
    setSuccessOpen(false);
    notify(level.board.fixedParts?.length ? '已重置电路。预设端点保留，请重新放入电阻并接线。' : '已重置为空白画布。请从元件库放入所有元件。');
  };
  const undo = () => {
    clearRunTimers();
    const previous = history.current.pop();
    if (!previous) { notify('没有可撤销的操作。'); return; }
    setGame(previous.game);
    setProbe(previous.probe?.target ? snapProbe(previous.game, previous.probe) : previous.probe);
    setPending(null);
    setSelected(null);
    setInventoryPart(null);
    setFailureOpen(false);
    setSuccessOpen(false);
    notify('已撤销上一步。');
  };
  const inspect = () => {
    clearRunTimers();
    setPending(null);
    if (report.success) {
      setClearedLevels(previous => [...new Set([...previous, level.id])]);
      setFailureOpen(false); setSuccessOpen(true);
    }
    else setFailureOpen(true);
  };
  const chooseResistor = (id, ohms) => {
    updateGame(level.model === 'resistor-dc-v1'
      ? { ...game, resistorValues: { ...game.resistorValues, [id]: ohms } }
      : { ...game, resistorOhms: ohms });
    setInventoryPart(null);
    if (selected === id && game.placed[id]) setSelected(id);
    notify('已选择 ' + ohms + ' Ω。观察电路实时读数，再判断是否符合目标。');
  };
  const movePart = (id, position) => {
    if (level.board.fixedParts?.includes(id)) return;
    const next = { ...game, positions: { ...game.positions, [id]: position } };
    setGame(next);
    setProbe(current => current && (current.target === id || current.target?.startsWith(id + '.'))
      ? { ...pinPosition(next, current.target), target: current.target }
      : current);
  };
  const finishMove = previous => {
    pointerTrace('move-committed', { before: previous.positions, after: game.positions });
    history.current.push({ game: previous, probe: probe && { ...probe } });
    setProbe(current => current ? snapProbe(game, current) : null);
  };
  const removeSelected = () => {
    if (!selected) return;
    if (level.board.fixedParts?.includes(selected)) return;
    if (selected === 'probe') {
      history.current.push({ game: structuredClone(game), probe: probe && { ...probe } });
      setProbe(null); setSelected(null); setMode('wire'); notify('探针已移回元件库。');
      return;
    }
    if (selected.startsWith('wire:')) {
      const key = selected.slice(5);
      updateGame({ ...game, wires: game.wires.filter(wire => normalizeWire(wire) !== key) });
      notify('连接已删除。');
    } else {
      updateGame({
        ...game,
        placed: { ...game.placed, [selected]: false },
        wires: game.wires.filter(wire => wire.split('-').every(endpoint => endpoint !== selected && !endpoint.startsWith(selected + '.'))),
      });
      notify('元件已移回元件库。');
    }
  };
  const flipLed = () => {
    updateGame({ ...game, reversed: !game.reversed });
    setSelected('led');
    notify('已翻转 LED 方向。');
  };
  const keepFocusInDialog = event => {
    if (event.key !== 'Tab') return;
    const buttons = [...event.currentTarget.querySelectorAll('button')];
    if (!buttons.length) return;
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  useEffect(() => {
    document.title = '关卡 ' + levelNumber + ' · ' + level.title + '｜电路实验室';
  }, [levelNumber, level.title]);
  useEffect(() => {
    try { window.localStorage.setItem('circuit-cleared-curriculum-v1', JSON.stringify(clearedLevels)); }
    catch { /* Progress remains available in this tab. */ }
  }, [clearedLevels]);
  useEffect(() => {
    const onKey = event => {
      if (failureOpen || successOpen) {
        if (event.key === 'Escape') { setFailureOpen(false); setSuccessOpen(false); }
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); undo(); }
      if (event.key === 'Escape') { setPending(null); setSelected(null); setInventoryPart(null); setMode('wire'); }
      if (event.key === 'Delete' && selected) removeSelected();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  useEffect(() => {
    if (!failureOpen && !successOpen) return;
    previousFocus.current = document.activeElement;
    dialogRef.current?.focus();
    return () => { if (previousFocus.current?.isConnected) previousFocus.current.focus(); };
  }, [failureOpen, successOpen]);
  useEffect(() => {
    if (!['overcurrent', 'resistor-overload', 'gpio-short', 'supply-short'].includes(report.kind)) return;
    failureTimer.current = setTimeout(() => setFailureOpen(true), ['overcurrent', 'resistor-overload'].includes(report.kind) ? 1050 : 650);
    return () => clearTimeout(failureTimer.current);
  }, [game, report.kind]);
  useEffect(() => () => { clearTimeout(timer.current); clearRunTimers(); }, []);
  return <div className="game-shell">
    <header className="topbar">
      <div className="brand"><Icon icon={Circuitry} size={40} weight="duotone" /><div><strong>电路实验室</strong><small>从电路到未来 · Make Engineers</small></div></div>
      <div className="chapter"><strong>{level.chapter}</strong><small>{level.chapterSubtitle}</small></div>
      <nav className="route" aria-label="关卡路线">{routeLevels.map(number => <button key={number} type="button" aria-label={'进入第 ' + number + ' 关'} aria-current={number === level.id ? 'step' : undefined} title={'第 ' + number + ' 关 · ' + getLevel(number).title} className={'route-node ' + (clearedLevels.includes(number) ? 'done ' : '') + (number === level.id ? 'current' : '')} onClick={() => goToLevel(number)}><i /><span>{String(number).padStart(3, '0')}</span></button>)}<select className="route-select" aria-label="切换关卡" value={level.id} onChange={event => goToLevel(Number(event.target.value))}>{levelIds.map(id => <option key={id} value={id}>第 {id} 关 · {getLevel(id).title}</option>)}</select></nav>
      <div className="progress"><strong>关卡 {levelNumber} <small>/ {levelIds.length}</small></strong><div><span className="progress-track"><i style={{ width: progressPercent + '%' }} /></span><small>{progressPercent}%</small></div></div>
      <button className="settings icon-button" aria-label="设置" onClick={() => notify('护眼暗色主题已启用。')}><Icon icon={GearSix} size={27} /></button>
    </header>
    <main className="workspace">
      <aside className="left-stack">
        <section className="panel quest-panel">
          <div className="panel-title gold"><Icon icon={Target} size={26} weight="duotone" /><h1>任务 {levelNumber} · {level.title}</h1></div>
          <div className="quest-content">
            <p className="story">{level.story}</p>
            <div className="goals"><div className="section-heading"><Icon icon={BookOpen} size={18} />任务目标</div>{level.goals.map((goal, index) => <div className="goal" key={goal.id}><span className={'goal-check ' + (checks[index] ? 'passed' : '')}>{checks[index] && <Icon icon={Check} size={13} weight="bold" />}</span><span>{goal.label}</span></div>)}</div>
            {level.calculations?.length > 0 && <div className="calculation-panel"><strong>计算验算</strong><small>先算出结果，再与探针读数比较</small>{level.calculations.map(item => <label key={item.key}><span>{item.label}</span><span className="calculation-input"><input type="number" min="0" step="any" inputMode="decimal" aria-label={item.label} value={game.answers?.[item.key] ?? ''} onChange={event => {
              const value = event.target.value;
              setGame(current => ({ ...current, answers: { ...current.answers, [item.key]: value } }));
            }} /><em>{item.unit}</em></span></label>)}</div>}
            <div className={'goal-summary ' + (report.success ? 'complete' : '')}><Icon icon={report.success ? Check : Target} size={21} weight="bold" /><strong>{report.success ? '目标全部达成 · ' + (level.model === 'resistor-dc-v1' ? '电路验证通过' : 'LED 已点亮') : '当前完成 ' + checks.filter(Boolean).length + ' / ' + checks.length + ' 项'}</strong><small>操作变化时自动更新</small></div>
          </div>
        </section>
        <section className="panel inventory-panel"><div className="panel-title"><Icon icon={Cpu} size={23} /><h2>元件库</h2><small>点击看参数 · 拖入画布</small></div>
          <div className="part-grid">{level.parts.filter(part => !level.board.fixedParts?.includes(part.id)).map(part => <button key={part.id} type="button" className={'part-tile ' + ((part.id === 'probe' ? probe : game.placed[part.id]) ? 'placed' : '')}
            onPointerDown={event => startInventoryDrag(event, part.id)} onPointerMove={moveInventoryDrag}
            onPointerUp={finishInventoryDrag} onPointerCancel={event => finishInventoryDrag(event, true)}
            onLostPointerCapture={event => { if (inventoryDrag.current?.pointerId === event.pointerId) { pointerTrace('inventory-capture-lost', { id: part.id, pointerId: event.pointerId }); inventoryDrag.current = null; setDragPreview(null); } }}
            onDragStart={event => event.preventDefault()}
            onClick={event => { if (suppressInventoryClick.current) { suppressInventoryClick.current = false; event.preventDefault(); return; } inspectInventory(part.id); }}>
            <InventoryIcon id={part.id} /><span>{part.label}</span><small>{(part.id === 'probe' ? probe : game.placed[part.id]) ? '已放置' : level.circuit.resistors?.includes(part.id) ? (game.resistorValues?.[part.id] ? game.resistorValues[part.id] + ' Ω' : '选阻值') : part.id === 'resistor' ? (game.resistorOhms ? game.resistorOhms + ' Ω' : '选阻值') : part.count}</small>
          </button>)}<button className="part-tile more" onClick={() => notify('更多元件将在后续关卡开放。')}><Icon icon={Plus} size={31} /><span>更多元件</span><small>敬请期待</small></button></div>
          <div className="inventory-tip"><Icon icon={HandTap} size={17} />点击查看参数，拖入搭建区放置</div>
          {inventoryPart && <div className="inventory-popover"><PartParameterMenu id={inventoryPart} level={level} game={game} placement onChooseResistor={chooseResistor} onClose={() => setInventoryPart(null)} onUseWire={() => { setMode('wire'); setInventoryPart(null); notify('连线模式：从一个端点拖到另一个端点。'); }} /></div>}
        </section>
      </aside>
      <section className="panel board-panel" aria-label="电路搭建区">
        <div className="board-header"><div><Icon icon={Cpu} size={23} /><strong>电路搭建区</strong><small>拖拽元件、连接端点，结果实时更新</small></div><div className="board-controls"><button className={mode === 'wire' ? 'active' : ''} aria-pressed={mode === 'wire'} onClick={() => setMode('wire')}><Icon icon={LinkSimple} size={18} />连线</button><button className={mode === 'probe' ? 'active' : ''} aria-pressed={mode === 'probe'} disabled={!probe} title={!probe ? '先从元件库拖入探针' : '点击端点切换探针测点'} onClick={() => { setMode('probe'); setPending(null); }}><Icon icon={Waveform} size={18} />测量</button><button onClick={() => setZoom(zoom === 100 ? 125 : zoom === 125 ? 80 : 100)}><Icon icon={MagnifyingGlassPlus} size={18} />{zoom}%<Icon icon={CaretDown} size={13} /></button></div></div>
        <div className="board-stage"><CircuitBoard level={level} game={game} componentStates={report.componentStates} currentPath={report.currentPath} flowEdges={report.flowEdges} failureEffect={['overcurrent', 'gpio-short', 'supply-short'].includes(report.kind) ? report.kind : null} probe={probe} probeReading={probeReading} mode={mode} pending={pending} selected={selected} zoom={zoom} onConnect={connect} onProbeChange={setProbe} onSelect={selectBoard} onMove={movePart} onMoveEnd={finishMove} onDropPart={addPart} onRemoveSelected={removeSelected} onFlipLed={flipLed} onChooseResistor={chooseResistor} />
          {!Object.values(game.placed).some(Boolean) && !probe && <div className="empty-board"><Icon icon={Circuitry} size={42} weight="duotone" /><strong>从空白电路开始</strong><span>点击左侧元件查看参数，再拖入 {requiredPartNames}</span><small>按住端点拖到另一端点松开连线 · 拖入探针即可观察波形</small></div>}
          {report.flowEdges.length > 0 && <div className="current-flow-legend"><i />常规电流方向 <span>{report.currentPath.flowLabel} · {report.currentLabel}</span></div>}
          {pending && <div className="board-message"><Icon icon={LinkSimple} size={16} />键盘已选起点：{pending}，聚焦另一端点按 Enter。Esc 取消。</div>}
          {notice && <div className="toast" role="status">{notice}</div>}
        </div>
        <div className="board-footer"><div><button onClick={undo}><Icon icon={ArrowCounterClockwise} size={20} />撤销 <kbd>Ctrl+Z</kbd></button><button onClick={reset}><Icon icon={ArrowCounterClockwise} size={20} />重置</button></div><span><Icon icon={Info} size={15} />教学简化模型 · 实时计算</span><button className="run-button" onClick={inspect}><Icon icon={Target} size={22} weight="fill" />检查电路</button></div>
      </section>
      <aside className="right-stack">
        <section className="panel output-panel"><div className="panel-title"><Icon icon={Waveform} size={24} /><h2>实时测量</h2><small>探针与波形同步</small></div><Scope reading={probeReading} level={level} /></section>
        <section className="panel hint-panel"><button onClick={() => setHintOpen(!hintOpen)} aria-expanded={hintOpen}><span><Icon icon={LightbulbFilament} size={22} />实验提示</span><Icon icon={CaretDown} size={17} className={hintOpen ? 'rotated' : ''} /></button>{hintOpen && <><p>{report.nextStep}</p>{level.experiments?.length > 0 && <div className="experiment-suggestions"><strong>通关后继续试试</strong><ul>{level.experiments.map(item => <li key={item}>{item}</li>)}</ul></div>}</>}</section>
      </aside>
    </main>
    {dragPreview && <div className="inventory-drag-preview" style={{ left: dragPreview.x + 14, top: dragPreview.y + 14 }} aria-hidden="true"><InventoryIcon id={dragPreview.id} /><span>{level.parts.find(part => part.id === dragPreview.id)?.label}</span></div>}
    {successOpen && <div className="success-overlay">
      <section ref={dialogRef} tabIndex={-1} onKeyDown={keepFocusInDialog} className="success-dialog" role="dialog" aria-modal="true" aria-labelledby="success-title" aria-describedby="success-detail">
        <div className="success-sparks" aria-hidden="true">{Array.from({ length: 12 }, (_, index) => <i key={index} style={{ '--spark-index': index }} />)}</div>
        <button className="success-close" aria-label="关闭通关提示" onClick={() => setSuccessOpen(false)}><Icon icon={X} size={20} /></button>
        <div className="success-emblem"><Icon icon={Trophy} size={54} weight="duotone" /></div>
        <div className="success-kicker">LEVEL {levelNumber} · CLEARED</div>
        <h2 id="success-title">{level.title}，通关！</h2>
        <p id="success-detail">{level.model === 'resistor-dc-v1' ? '节点电压、两条支路电流与功率均满足设计目标；' : 'GPIO0 经限流电阻驱动 LED，'}{level.goals.length} 项任务目标全部达成。</p>
        {level.model === 'resistor-dc-v1'
          ? <div className="success-metrics"><div><small>节点 A</small><strong>{report.network.nodeAV.toFixed(2)} V</strong></div><div><small>总电流</small><strong>{report.currentLabel}</strong></div><div><small>R2 / R3 · mA</small><strong>{report.network.r2CurrentMa.toFixed(2)} / {report.network.r3CurrentMa.toFixed(2)}</strong></div></div>
          : <div className="success-metrics"><div><small>GPIO 高电平</small><strong>{level.electrical.gpioHighV.toFixed(1)} V</strong></div><div><small>限流电阻</small><strong>{game.resistorOhms} Ω</strong></div><div><small>支路电流</small><strong>{report.currentLabel}</strong></div></div>}
        <div className="success-note"><Icon icon={Check} size={18} weight="bold" />{level.model === 'resistor-dc-v1' ? 'KCL、KVL 与元件功率均通过检查' : '电流符合本关目标范围，LED 正常点亮'}</div>
        {nextLevel && <button className="success-primary" onClick={() => goToLevel(nextLevel.id)}>进入第 {nextLevel.id} 关 · {nextLevel.title}</button>}
        <button className={nextLevel ? 'success-secondary' : 'success-primary'} onClick={() => setSuccessOpen(false)}>返回电路继续探索</button>
      </section>
    </div>}
    {failureOpen && <div className="failure-overlay">
      <section ref={dialogRef} tabIndex={-1} onKeyDown={keepFocusInDialog} className={'failure-dialog ' + (burned ? 'is-burned' : '')} role="dialog" aria-modal="true" aria-labelledby="failure-title" aria-describedby="failure-observed">
        <div className="failure-kicker"><Icon icon={WarningOctagon} size={19} weight="fill" />当前电路结果 <button aria-label="关闭结果并返回电路" onClick={() => setFailureOpen(false)}><Icon icon={X} size={19} /></button></div>
        <div className="failure-heading"><div className="failure-symbol"><Icon icon={burned ? Lightbulb : WarningOctagon} size={41} weight="duotone" /></div><div><span>挑战未达成</span><h2 id="failure-title">{report.headline}</h2></div></div>
        <div className="failure-facts">
          <div><span>观察到</span><p id="failure-observed">{report.observed}</p></div>
          <div><span>原因分析</span><p>{report.explanation}</p></div>
          <div><span>下一步</span><p>{report.nextStep}</p></div>
        </div>
        {report.note && <p className="failure-model-note"><Icon icon={Info} size={17} />{report.note}</p>}
        <div className="failure-actions"><span>调整电路，再试一次吧。</span><div><button className="failure-secondary" onClick={() => setFailureOpen(false)}>返回修改</button><button className="failure-primary" onClick={reset}><Icon icon={ArrowCounterClockwise} size={18} />重试本关</button></div></div>
      </section>
    </div>}
    <footer className="site-footer"><span>ELECTRONICS LAB　v1.0</span><span>学习 · 实践 · 创造</span><span>Small Circuits　Make A Brighter Tomorrow.</span></footer>
  </div>;
}
