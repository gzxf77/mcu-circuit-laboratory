import { useEffect, useRef, useState } from 'react';
import {
  ArrowCounterClockwise, BookOpen, CaretDown, Check, Circuitry, Cpu,
  GearSix, HandTap, Info, Lightbulb, LightbulbFilament,
  LinkSimple, MagnifyingGlassPlus, Plus, Power, Target,
  Trophy, WarningOctagon, Waveform, X
} from '@phosphor-icons/react';
import { CircuitBoard } from './CircuitBoard';
import { nextResistorId } from './componentCatalog';
import { clientPointInSvg, pinPosition, snapComponentPosition, snapProbe } from './circuitGeometry';
import { evaluateCircuit, normalizeWire, startGame, wireKey } from './evaluateCircuit';
import { shouldAutoInspect } from './faultPolicy';
import { referenceAnswer } from './levelAnswer';
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
  if (id === 'isource') return <svg className="inventory-symbol isource-symbol" viewBox="0 0 40 40" aria-hidden="true">
    <path className="symbol-lead" d="M3 20h6m22 0h6" /><circle cx="20" cy="20" r="11" />
    <path d="M13 20h13M22 15l5 5-5 5" />
  </svg>;
  if (id === 'vccs') return <svg className="inventory-symbol vccs-symbol" viewBox="0 0 40 40" aria-hidden="true">
    <path className="symbol-lead" d="M3 20h5m24 0h5" /><path d="M8 20 20 10 32 20 20 30Z" />
    <path d="M13 20h13M22 15l5 5-5 5" />
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
  const supplyV = level.electrical.sourceV ?? level.electrical.gpioHighV ?? level.electrical.scopeMaxV ?? 5;
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
const judgeOnly = !!level.ui?.judgeOnly;
  const [clearedLevels, setClearedLevels] = useState(() => {
    try {
      const stored = JSON.parse(window.localStorage.getItem('circuit-cleared-curriculum-v1') || '[]');
      return Array.isArray(stored) ? stored.filter(Number.isInteger) : [];
    }
    catch { return []; }
  });
  const [game, setGame] = useState(() => startGame(false, level));
  const [judgeDir, setJudgeDir] = useState('right');
  const [probe, setProbe] = useState(() => {
    const target = level.circuit.defaultProbeTarget;
    if (!target || !game.positions[target]) return null;
    return snapProbe(game, game.positions[target]);
  });
  const [failureOpen, setFailureOpen] = useState(false);
  const [successOpen, setSuccessOpen] = useState(false);
  const [answerOpen, setAnswerOpen] = useState(false);
  // The reference answer is data: wiring, values, readings and judgements all
  // come from the level's own reference build.
  // Pass the live game so the answer page can mark a tunable value that is still
  // at its default (for example "跨导 g = 0.50 mS（当前 0.25 mS）").
  const answer = answerOpen ? referenceAnswer(level, game) : null;
  const [pending, setPending] = useState(null);
  // 第1关这类"只判断、不搭建"的关卡，进来就默认选中第一个待判断元件，
  // 让判断菜单直接弹出，玩家一眼知道去哪里答题。
  const [selected, setSelected] = useState(() => {
    const first = level.circuit?.resistors?.[0] || level.circuit?.resistorSlots?.[0];
    return first && game.placed[first] ? first : null;
  });
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
  const selectBoard = id => {
    pointerTrace('selection', { from: selected, to: id });
    setInventoryPart(null);
    setSelected(id);
  };
  const inspectInventory = id => { setSelected(null); if (id === 'resistor' && level.circuit.resistorSlots) { notify('把电阻拖到搭建区放置；放好后点击画布上的电阻可调阻值。'); return; } setInventoryPart(current => current === id ? null : id); };
  // `keepSelection` is for controls that live inside the component menu: a slider
  // or a judgement button must not close the very menu it is in. `coalesce` folds a
  // whole drag of such a control into one undo step.
  const updateGame = (next, { keepSelection = false, coalesce = false } = {}) => {
    clearRunTimers();
    if (!coalesce || !coalescedUpdate.current) history.current.push({ game: structuredClone(game), probe: probe && { ...probe } });
    coalescedUpdate.current = coalesce;
    setGame(next);
    setProbe(current => current?.target && !next.placed[current.target.split('.')[0]]
      ? { ...current, target: null, wire: null }
      : current?.wire && !next.wires.some(wire => normalizeWire(wire) === current.wire)
        ? { ...current, target: null, wire: null } : current);
    if (!keepSelection) setSelected(null);
    setFailureOpen(false);
    setSuccessOpen(false);
  };
  const addPart = (id, position) => {
    pointerTrace('place-request', { id, position, alreadyPlaced: !!game.placed[id] });
    if (!position) return;
    if (level.board.fixedParts?.includes(id)) return;
    if (id === 'wire') { notify('按住一个端点，拖到另一个端点后松开即可连线。'); return; }
    if (id === 'resistor') {
      // Lowest free instance id, unbounded: deleting R2 and placing again gives
      // R2, and a sandbox board never runs out of resistor slots.
      const next = nextResistorId(game.placed);
      const ohms = game.resistorValues?.[next] ?? level.electrical.defaultOhms?.[next] ?? 1000;
      updateGame({
        ...game,
        placed: { ...game.placed, [next]: true },
        positions: { ...game.positions, [next]: snapComponentPosition(next, position) },
        resistorValues: { ...game.resistorValues, [next]: ohms },
      });
      notify('电阻已放置（' + next.toUpperCase() + '，' + ohms + ' Ω）。拖动端点连线，点击电阻可调阻值。');
      return;
    }
    if (id === 'probe') {
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
  const coalescedUpdate = useRef(false);
  // The rated power of a part is a design choice like its resistance: it must not
  // close the menu it was chosen in.
  const chooseRating = (id, watts) => {
    updateGame({ ...game, resistorRatings: { ...game.resistorRatings, [id]: watts } }, { keepSelection: true });
  };
  const tuneGain = (id, value) => {
    updateGame({ ...game, controlledGmMs: value }, { keepSelection: true, coalesce: true });
  };
  const judgePower = (id, verdict) => {
    // Judging several elements in a row must keep the menu open.
    updateGame({ ...game, powerJudging: { ...game.powerJudging, [id]: verdict } }, { keepSelection: true });
  };
  const judgePowerValue = (id, val) => {
    updateGame({ ...game, powerValue: { ...game.powerValue, [id]: Number(val) } }, { keepSelection: true });
  };
  // 题1-1(1)(2): reference-direction association and what ui represents.
  const judgeAssoc = (id, value) => {
    updateGame({ ...game, assocJudging: { ...game.assocJudging, [id]: value } }, { keepSelection: true });
  };
  const judgeUiMeaning = (id, value) => {
    updateGame({ ...game, uiMeaningJudging: { ...game.uiMeaningJudging, [id]: value } }, { keepSelection: true });
  };
  const setJudgeDirection = dir => setJudgeDir(dir);
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
      setProbe(null); setSelected(null); notify('探针已移回元件库。');
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
      if (event.key === 'Escape') { setPending(null); setSelected(null); setInventoryPart(null); }
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
    // Only faults that stop the circuit working explain themselves; a part over
    // its rated power is a state the player is meant to notice (see faultPolicy).
    if (!shouldAutoInspect(report.kind)) return;
    failureTimer.current = setTimeout(() => setFailureOpen(true), 650);
    return () => clearTimeout(failureTimer.current);
  }, [game, report.kind]);
  useEffect(() => () => { clearTimeout(timer.current); clearRunTimers(); }, []);
  return <div className="game-shell">
    <header className="topbar">
      <div className="brand"><Icon icon={Circuitry} size={40} weight="duotone" /><div><strong>电路实验室</strong><small>从电路到未来 · Make Engineers</small></div></div>
      {!judgeOnly && <div className="chapter"><strong>{level.chapter}</strong><small>{level.chapterSubtitle}</small></div>}
      <nav className="route" aria-label="关卡路线">{routeLevels.map(number => <button key={number} type="button" aria-label={'进入第 ' + number + ' 关'} aria-current={number === level.id ? 'step' : undefined} title={'第 ' + number + ' 关 · ' + getLevel(number).title} className={'route-node ' + (clearedLevels.includes(number) ? 'done ' : '') + (number === level.id ? 'current' : '')} onClick={() => goToLevel(number)}><i /><span>{String(number).padStart(3, '0')}</span></button>)}<select className="route-select" aria-label="切换关卡" value={level.id} onChange={event => goToLevel(Number(event.target.value))}>{levelIds.map(id => <option key={id} value={id}>第 {id} 关 · {getLevel(id).title}</option>)}</select></nav>
      <div className="progress"><strong>关卡 {levelNumber} <small>/ {levelIds.length}</small></strong><div><span className="progress-track"><i style={{ width: progressPercent + '%' }} /></span><small>{progressPercent}%</small></div></div>
      <button className="settings icon-button" aria-label="设置" onClick={() => notify('护眼暗色主题已启用。')}><Icon icon={GearSix} size={27} /></button>
    </header>
    <main className="workspace">
      <aside className="left-stack">
        <section className="panel quest-panel">
          <div className="panel-title gold"><Icon icon={Target} size={26} weight="duotone" /><h1>任务 {levelNumber} · {level.title}</h1></div>
          <div className="quest-content">
            {judgeOnly ? (() => {
              const kinds = {};
              const visit = c => { if (!c || typeof c !== 'object') return;
                for (const k of ['powerJudged','assocJudged','uiMeaningJudged','powerValueJudged']) if (c[k]) { kinds[c[k].id] ||= new Set(); kinds[c[k].id].add(k); }
                for (const key of ['all','any']) (c[key]||[]).forEach(visit); };
              level.goals.forEach(g => visit(g.when));
              return <div className="goals">
                <div className="section-heading"><Icon icon={BookOpen} size={18} />作答</div>
                {Object.keys(kinds).filter(id => !game.picked || id === game.picked).map(id => {
                  const k = kinds[id];
                  return (
                  <div className="judge-card" key={id}>
                    <div className="judge-card-title">{level.judgeLabels?.[id] || (id === 'power' ? '电源' : id.toUpperCase())}</div>
                    {k.has('assocJudged') && <div className="judge-step"><span className="judge-q">① u、i 的参考方向是否关联…</span>
                      <div className="power-judge-options">
                        <button type="button" className={game.assocJudging?.[id] === 'in' ? 'chosen' : ''} onClick={() => judgeAssoc(id, 'in')}>流入（关联）</button>
                        <button type="button" className={game.assocJudging?.[id] === 'out' ? 'chosen' : ''} onClick={() => judgeAssoc(id, 'out')}>流出（非关联）</button>
                      </div>
                    </div>}
                    {k.has('uiMeaningJudged') && <div className="judge-step"><span className="judge-q">② 那么 ui 乘积表示…</span>
                      <div className="power-judge-options">
                        <button type="button" className={game.uiMeaningJudging?.[id] === 'absorb' ? 'chosen' : ''} onClick={() => judgeUiMeaning(id, 'absorb')}>吸收功率</button>
                        <button type="button" className={game.uiMeaningJudging?.[id] === 'deliver' ? 'chosen' : ''} onClick={() => judgeUiMeaning(id, 'deliver')}>发出功率</button>
                      </div>
                    </div>}
                    {k.has('powerJudged') && <div className="judge-step"><span className="judge-q">{k.has('assocJudged') ? '③ ' : ''}它实际吸收还是发出功率…</span>
                      <div className="power-judge-options">
                        <button type="button" className={game.powerJudging?.[id] === 'absorb' ? 'chosen' : ''} onClick={() => judgePower(id, 'absorb')}>吸收功率</button>
                        <button type="button" className={game.powerJudging?.[id] === 'deliver' ? 'chosen' : ''} onClick={() => judgePower(id, 'deliver')}>发出功率</button>
                      </div>
                    </div>}
                    {k.has('powerValueJudged') && <div className="judge-step"><span className="judge-q">它吸收的功率是多少 W（发出填负）</span>
                      <div className="power-judge-options">
                        <input type="number" step="0.1" className="power-value-input" placeholder="填 W" value={game.powerValue?.[id] ?? ''} onChange={e => judgePowerValue(id, e.target.value)} />
                      </div>
                    </div>}
                  </div>
                );})}
              </div>;
            })() : (
              <div className="goals"><div className="section-heading"><Icon icon={BookOpen} size={18} />任务目标</div>{level.goals.map((goal, index) => <div className="goal" key={goal.id}><span className={'goal-check ' + (checks[index] ? 'passed' : '')}>{checks[index] && <Icon icon={Check} size={13} weight="bold" />}</span><span>{goal.label}</span></div>)}</div>
            )}
            <div className={'goal-summary ' + (report.success ? 'complete' : '')}><Icon icon={report.success ? Check : Target} size={21} weight="bold" /><strong>{report.success ? '目标全部达成' : '完成作答后点「提交答案」'}</strong><small>{judgeOnly ? '选择后统一判分，不实时提示' : '操作变化时自动更新'}</small></div>
          </div>
        </section>
        {!judgeOnly && <section className="panel inventory-panel"><div className="panel-title"><Icon icon={Cpu} size={23} /><h2>元件库</h2><small>点击看参数 · 拖入画布</small></div>
          <div className="part-grid">{level.parts.filter(part => !level.board.fixedParts?.includes(part.id)).map(part => { const slots = part.id === 'resistor' ? (level.circuit.resistorSlots || []) : null; const slotLimit = slots?.length || 0; const placedCount = slots ? Object.keys(game.placed).filter(id => game.placed[id] && /^r\d+$/.test(id) && !level.board.fixedParts?.includes(id)).length : 0; const isFull = slotLimit > 0 && placedCount >= slotLimit; const isPlaced = part.id === 'probe' ? probe : slots ? isFull : Boolean(game.placed[part.id]); return <button key={part.id} type="button" className={'part-tile ' + (isPlaced ? 'placed' : '')}
            onPointerDown={event => startInventoryDrag(event, part.id)} onPointerMove={moveInventoryDrag}
            onPointerUp={finishInventoryDrag} onPointerCancel={event => finishInventoryDrag(event, true)}
            onLostPointerCapture={event => { if (inventoryDrag.current?.pointerId === event.pointerId) { pointerTrace('inventory-capture-lost', { id: part.id, pointerId: event.pointerId }); inventoryDrag.current = null; setDragPreview(null); } }}
            onDragStart={event => event.preventDefault()}
            onClick={event => { if (suppressInventoryClick.current) { suppressInventoryClick.current = false; event.preventDefault(); return; } inspectInventory(part.id); }}>
            <InventoryIcon id={part.id} /><span>{part.label}</span><small>{slots ? (placedCount ? '已放 ' + placedCount + (slotLimit ? ' / ' + slotLimit : '') + ' 只' : slotLimit ? '最多 ' + slotLimit + ' 只' : '∞ 只可放') : (part.id === 'probe' ? probe : game.placed[part.id]) ? '已放置' : part.count}</small>
          </button>})}</div>
          <div className="inventory-tip"><Icon icon={HandTap} size={17} />点击查看参数，拖入搭建区放置</div>
          {inventoryPart && <div className="inventory-popover"><PartParameterMenu id={inventoryPart} level={level} game={game} placement onChooseResistor={chooseResistor} onClose={() => setInventoryPart(null)} onUseWire={() => { setInventoryPart(null); notify('按住一个端点，拖到另一个端点后松开即可连线。'); }} /></div>}
        </section>}
      </aside>
      <section className="panel board-panel" aria-label="电路搭建区">
        <div className="board-header"><div><Icon icon={Cpu} size={23} /><strong>电路搭建区</strong><small>拖拽元件、连接端点，结果实时更新</small></div><div className="board-controls"><button onClick={() => setZoom(zoom === 100 ? 125 : zoom === 125 ? 80 : 100)}><Icon icon={MagnifyingGlassPlus} size={18} />{zoom}%<Icon icon={CaretDown} size={13} /></button></div></div>
        <div className="board-stage"><CircuitBoard level={level} game={game} componentStates={report.componentStates} currentPath={report.currentPath} flowEdges={report.flowEdges} failureEffect={['overcurrent', 'gpio-short', 'supply-short', 'current-source-short'].includes(report.kind) ? report.kind : null} probe={probe} probeReading={probeReading} pending={pending} selected={selected} zoom={zoom} onConnect={connect} onProbeChange={setProbe} onSelect={selectBoard} onMove={movePart} onMoveEnd={finishMove} onDropPart={addPart} onRemoveSelected={removeSelected} onFlipLed={flipLed} onChooseResistor={chooseResistor} onJudgePower={judgePower} onTuneGain={tuneGain} onJudgeAssoc={judgeAssoc} onJudgeUiMeaning={judgeUiMeaning} onChooseRating={chooseRating} judgeDir={judgeDir} onJudgeDir={setJudgeDirection} />
          {!Object.values(game.placed).some(Boolean) && !probe && <div className="empty-board"><Icon icon={Circuitry} size={42} weight="duotone" /><strong>从空白电路开始</strong><span>点击左侧元件查看参数，再拖入 {requiredPartNames}</span><small>按住端点拖到另一端点松开连线 · 拖入探针即可观察波形</small></div>}
          {!judgeOnly && report.flowEdges.length > 0 && <div className="current-flow-legend"><i />实时电流 <span>{report.currentLabel}</span></div>}
          {pending && <div className="board-message"><Icon icon={LinkSimple} size={16} />键盘已选起点：{pending}，聚焦另一端点按 Enter。Esc 取消。</div>}
          {notice && <div className="toast" role="status">{notice}</div>}
        </div>
        <div className="board-footer"><div><button onClick={undo}><Icon icon={ArrowCounterClockwise} size={20} />撤销 <kbd>Ctrl+Z</kbd></button><button onClick={reset}><Icon icon={ArrowCounterClockwise} size={20} />重置</button><button onClick={() => setAnswerOpen(true)}><Icon icon={Lightbulb} size={20} />查看答案</button></div><span><Icon icon={Info} size={15} />教学简化模型 · 实时计算</span><button className="run-button" onClick={inspect}><Icon icon={Target} size={22} weight="fill" />{judgeOnly ? "提交答案" : "检查电路"}</button></div>
      </section>
      <aside className="right-stack">
        {!judgeOnly && <section className="panel output-panel"><div className="panel-title"><Icon icon={Waveform} size={24} /><h2>实时测量</h2><small>探针与波形同步</small></div><Scope reading={probeReading} level={level} /></section>}
        <section className="panel knowledge-panel"><div className="panel-title"><Icon icon={LightbulbFilament} size={22} /><h2>知识卡</h2></div>{level.intro && <p className="knowledge-intro">{level.intro}</p>}{(Array.isArray(level.knowledge) ? level.knowledge : level.knowledge ? [level.knowledge] : []).map((card, index) => (
          <div className="knowledge-card" key={card.title + index}><strong>{card.title}</strong><code>{card.formula}</code><small>{card.text}</small></div>
        ))}{!level.knowledge && (<><p>{report.nextStep}</p>{level.experiments?.length > 0 && <div className="experiment-suggestions"><strong>通关后继续试试</strong><ul>{level.experiments.map(item => <li key={item}>{item}</li>)}</ul></div>}</>)}</section>
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
        <p id="success-detail">{judgeOnly ? '参考方向与功率符号判断全部正确；' : level.model !== 'resistor-dc-v1' ? 'GPIO0 经限流电阻驱动 LED，' : level.circuit.currentSource ? '源电流按并联支路分配，节点电压满足目标；' : '节点电压与总电流满足目标；'}{level.goals.length} 项任务目标全部达成。</p>
        {!judgeOnly && (level.model !== 'resistor-dc-v1'
          ? <div className="success-metrics"><div><small>GPIO 高电平</small><strong>{level.electrical.gpioHighV.toFixed(1)} V</strong></div><div><small>限流电阻</small><strong>{game.resistorOhms} Ω</strong></div><div><small>支路电流</small><strong>{report.currentLabel}</strong></div></div>
          : level.circuit.currentSource && level.circuit.source
            ? <div className="success-metrics"><div><small>节点 A</small><strong>{report.network.nodeAV.toFixed(2)} V</strong></div><div><small>电压源输出</small><strong>{report.network.voltageSourceCurrentMa.toFixed(2)} mA</strong></div><div><small>电流源端电压</small><strong>{report.network.currentSourceVoltageV.toFixed(2)} V</strong></div></div>
          : level.circuit.currentSource
            ? <div className="success-metrics"><div><small>节点 A</small><strong>{report.network.nodeAV.toFixed(2)} V</strong></div><div><small>电流源电流</small><strong>{level.electrical.sourceCurrentMa.toFixed(2)} mA（恒定）</strong></div><div><small>等效电阻</small><strong>{report.network.equivalentOhms ? report.network.equivalentOhms.toFixed(0) + ' Ω' : '—'}</strong></div></div>
            : <div className="success-metrics"><div><small>节点 A</small><strong>{report.network.nodeAV.toFixed(2)} V</strong></div><div><small>总电流</small><strong>{report.currentLabel}</strong></div><div><small>使用电阻</small><strong>{Object.keys(game.placed).filter(id => game.placed[id] && /^r\d+$/.test(id)).length} 只</strong></div></div>)}
        <div className="success-note"><Icon icon={Check} size={18} weight="bold" />{judgeOnly ? '关联方向下 P=ui 的符号决定吸收还是发出' : level.model !== 'resistor-dc-v1' ? '电流符合本关目标范围，LED 正常点亮' : level.circuit.currentSource ? 'KCL：源电流 = 各支路电流之和；节点电压由外电路决定' : 'KCL、KVL 与元件功率均通过检查'}</div>
        {report.note && <p className="model-note"><Icon icon={Info} size={17} />{report.note}</p>}
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
        {report.note && <p className="model-note"><Icon icon={Info} size={17} />{report.note}</p>}
        <div className="failure-actions"><span>调整电路，再试一次吧。</span><div><button className="failure-secondary" onClick={() => setFailureOpen(false)}>返回修改</button><button className="failure-primary" onClick={reset}><Icon icon={ArrowCounterClockwise} size={18} />重试本关</button></div></div>
      </section>
    </div>}
    {answerOpen && answer && <div className="failure-overlay">
      <section ref={dialogRef} tabIndex={-1} onKeyDown={keepFocusInDialog} className="answer-dialog" role="dialog" aria-modal="true" aria-labelledby="answer-title">
        <div className="failure-kicker"><Icon icon={Lightbulb} size={19} weight="fill" />本关参考解 <button aria-label="关闭参考解" onClick={() => setAnswerOpen(false)}><Icon icon={X} size={19} /></button></div>
        <h2 id="answer-title">{level.title} · 参考答案</h2>
        <p className="answer-lead">{judgeOnly ? '按图上给定的 u、i 符号判断：关联方向下 P=ui，符号决定吸收还是发出。' : '这份接法来自本关的参考解；任何满足目标读数的等效接法同样合格。建议看完后按「重置」自己重搭一遍。'}</p>
        {!judgeOnly && answer.wires.length > 0 && <div className="answer-columns">
          <div><span>参考接法</span><ul>{answer.wires.map((wire, index) => <li key={index}>{wire}</li>)}</ul></div>
          <div><span>参考取值</span><ul>{answer.values.length > 0 ? answer.values.map(value => <li key={value.id}>{value.text}</li>) : <li>本关元件参数固定</li>}</ul></div>
        </div>}
        {!judgeOnly && answer.readings.length > 0 && <div className="answer-metrics">{answer.readings.map(reading => <div key={reading.label}><small>{reading.label}</small><strong>{reading.text}</strong></div>)}</div>}
        {!judgeOnly && answer.powers.length > 0 && <div className="failure-facts"><div><span>参考解里各元件的功率（吸收为正）</span><p>{answer.powers.map(power => power.text).join('；')}。全部吸收功率之和等于释放功率之和。</p></div></div>}
        {answer.judgements.length > 0 && <div className="failure-facts"><div><span>判断答案</span><p>{answer.judgements.map(item => item.text).join('；')}。</p></div></div>}
        <div className="failure-actions"><span>答案只解决这一关，思路才解决下一关。</span><div><button className="failure-secondary" onClick={() => setAnswerOpen(false)}>返回电路</button><button className="failure-primary" onClick={() => { setAnswerOpen(false); reset(); }}><Icon icon={ArrowCounterClockwise} size={18} />重置并重搭</button></div></div>
      </section>
    </div>}
    <footer className="site-footer"><span>ELECTRONICS LAB　v1.0</span><span>学习 · 实践 · 创造</span><span>Small Circuits　Make A Brighter Tomorrow.</span></footer>
  </div>;
}
