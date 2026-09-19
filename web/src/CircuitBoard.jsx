import { useEffect, useRef, useState } from 'react';
import { boardGrid, clientPointInSvg, geometryWireKey as wireKey, pinPosition, routePath, snapComponentPosition, snapProbe, terminalAtPoint, wireRoute } from './circuitGeometry';
import { PartParameterMenu } from './PartParameterMenu';
import { pointerTrace } from './pointerTrace';

const pathFor = (a, b, key, from) => routePath(wireRoute(a, b, key, from));
function Pin({ id, x, y, pending, hovered, onStart, onProbe, onKeyboardConnect }) {
  return <g className={'board-pin ' + (pending === id || hovered === id ? 'pending' : '')} role="button" tabIndex={0} aria-label={'连接端点 ' + id}
    onPointerDown={event => { event.stopPropagation(); onStart(event, id); }} onClick={event => { event.stopPropagation(); if (onProbe) onProbe(id); }}
    onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); if (onProbe) onProbe(id); else onKeyboardConnect(id); } }}>
    <circle className="pin-hit" cx={x} cy={y} r="20" />
    <circle className="pin-visible" cx={x} cy={y} r="8" />
  </g>;
}
export function CircuitBoard({ level, game, componentStates, currentPath, flowEdges, failureEffect, probe, probeReading, mode, pending, selected, zoom, onConnect, onProbeChange, onSelect, onMove, onMoveEnd, onDropPart, onRemoveSelected, onFlipLed, onChooseResistor, onToggleSuspect }) {
  const svg = useRef(null);
  const menuRef = useRef(null);
  const drag = useRef(null);
  const probeDrag = useRef(null);
  const wireDrag = useRef(null);
  const [wirePreview, setWirePreview] = useState(null);
  const [size, setSize] = useState({ width: 900, height: 700 });
  const [menuHeight, setMenuHeight] = useState(104);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width && height) setSize({ width, height });
    });
    observer.observe(svg.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!menuRef.current) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.height) setMenuHeight(entry.contentRect.height);
    });
    observer.observe(menuRef.current);
    return () => observer.disconnect();
  }, [selected]);
  const baseWidth = 900 * 100 / zoom;
  const baseHeight = 700 * 100 / zoom;
  const aspect = size.width / size.height;
  const viewWidth = Math.max(baseWidth, baseHeight * aspect);
  const viewHeight = Math.max(baseHeight, baseWidth / aspect);
  const viewX = (900 - viewWidth) / 2;
  const viewY = (700 - viewHeight) / 2;
  const viewBox = [viewX, viewY, viewWidth, viewHeight].join(' ');
  const flowDirection = new Map(flowEdges.map(([from, to]) => [wireKey(from, to), [from, to]]));
  const pointFor = event => {
    return clientPointInSvg(
      { x: event.clientX, y: event.clientY },
      svg.current.getBoundingClientRect(),
      svg.current.viewBox.baseVal,
    );
  };
  const startWire = (event, id) => {
    if (event.button !== 0 || mode !== 'wire') return;
    event.preventDefault();
    pointerTrace('wire-down', { id, pointerId: event.pointerId });
    wireDrag.current = { id, pointerId: event.pointerId };
    setWirePreview({ from: id, point: pinPosition(game, id), target: null });
    svg.current.setPointerCapture(event.pointerId);
    onSelect(null);
  };
  const startMove = (event, id) => {
    if (event.button !== 0) return;
    if (level.board.fixedParts?.includes(id)) { event.stopPropagation(); onSelect(id); return; }
    pointerTrace('part-down', { id, pointerId: event.pointerId, pointerType: event.pointerType, target: event.target.tagName, className: event.target.getAttribute('class'), x: event.clientX, y: event.clientY, selected });
    event.preventDefault();
    event.stopPropagation();
    const p = pointFor(event);
    drag.current = {
      id, dx: game.positions[id].x - p.x, dy: game.positions[id].y - p.y,
      startX: event.clientX, startY: event.clientY,
      previous: structuredClone(game), moved: false, lastPosition: game.positions[id],
    };
    svg.current.setPointerCapture(event.pointerId);
    pointerTrace('capture-set', { id, pointerId: event.pointerId, captured: svg.current.hasPointerCapture(event.pointerId) });
    onSelect(null);
  };
  const startProbeMove = event => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const point = pointFor(event);
    probeDrag.current = { dx: probe.x - point.x, dy: probe.y - point.y, startX: event.clientX, startY: event.clientY, moved: false };
    svg.current.setPointerCapture(event.pointerId);
    onSelect(null);
  };
  const move = event => {
    if (wireDrag.current?.pointerId === event.pointerId) {
      const target = terminalAtPoint(game, pointFor(event), wireDrag.current.id);
      setWirePreview({ from: wireDrag.current.id, point: target ? pinPosition(game, target) : pointFor(event), target });
      return;
    }
    if (probeDrag.current) {
      if (!probeDrag.current.moved && Math.hypot(event.clientX - probeDrag.current.startX, event.clientY - probeDrag.current.startY) < 5) return;
      probeDrag.current.moved = true;
      const point = pointFor(event);
      onProbeChange(snapProbe(game, { x: point.x + probeDrag.current.dx, y: point.y + probeDrag.current.dy }));
      return;
    }
    if (!drag.current) return;
    if (!drag.current.moved && Math.hypot(event.clientX - drag.current.startX, event.clientY - drag.current.startY) < 5) return;
    if (!drag.current.moved) pointerTrace('part-move-start', { id: drag.current.id, pointerId: event.pointerId, x: event.clientX, y: event.clientY });
    const p = pointFor(event);
    drag.current.moved = true;
    const position = snapComponentPosition(drag.current.id, {
      x: p.x + drag.current.dx,
      y: p.y + drag.current.dy,
    });
    drag.current.lastPosition = position;
    onMove(drag.current.id, position);
  };
  const endMove = (event, cancelled = false) => {
    if (wireDrag.current?.pointerId === event.pointerId) {
      const from = wireDrag.current.id;
      const target = cancelled ? null : terminalAtPoint(game, pointFor(event), from);
      wireDrag.current = null;
      setWirePreview(null);
      if (target) onConnect(from, target);
      pointerTrace(cancelled ? 'wire-cancel' : 'wire-up', { from, target });
      return;
    }
    pointerTrace(cancelled ? 'pointer-cancel' : 'pointer-up', { pointerId: event.pointerId, target: event.target.tagName, part: drag.current?.id, moved: drag.current?.moved, lastPosition: drag.current?.lastPosition, captured: svg.current?.hasPointerCapture(event.pointerId), probeMoved: probeDrag.current?.moved });
    if (probeDrag.current) {
      if (!probeDrag.current.moved && !cancelled) onSelect('probe');
      probeDrag.current = null;
      return;
    }
    if (drag.current?.moved) {
      const { id, previous, lastPosition } = drag.current;
      if (lastPosition.x !== previous.positions[id].x || lastPosition.y !== previous.positions[id].y) onMoveEnd(previous);
    } else if (drag.current && !cancelled) onSelect(drag.current.id);
    drag.current = null;
  };
  const keyboardSelect = (event, id) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault(); event.stopPropagation(); onSelect(id);
    }
  };
  const handlePin = id => {
    if (mode === 'probe') {
      const point = pinPosition(game, id);
      onProbeChange({ ...point, target: id, wire: null });
    } else if (mode === 'wire') onConnect(id);
    else onSelect(id.split('.')[0]);
  };
  const pinProps = { pending: pending || wirePreview?.from, hovered: wirePreview?.target, onStart: startWire,
    onProbe: mode === 'probe' ? handlePin : null, onKeyboardConnect: handlePin };
  const drop = event => {
    event.preventDefault();
    const id = event.dataTransfer.getData('text/plain');
    pointerTrace('inventory-drop', { id, x: event.clientX, y: event.clientY });
    if (!id) return;
    const p = pointFor(event);
    onDropPart(id, { x: Math.round(p.x), y: Math.round(p.y) });
  };
  const resistor = game.positions.resistor;
  const led = game.positions.led;
  const resistorState = componentStates.resistor?.state || 'normal';
  const ledState = componentStates.led?.state || 'normal';
  const ledBrightness = componentStates.led?.brightness || 0;
  const ledVisualStyle = {
    '--led-lightness': (0.48 + 0.82 * ledBrightness).toFixed(3),
    '--led-ray-opacity': (0.2 + 0.8 * ledBrightness).toFixed(3),
    '--led-glow-radius': (3 + 16 * ledBrightness).toFixed(1) + 'px',
    '--led-halo-opacity': (0.12 + 0.62 * ledBrightness).toFixed(3),
    '--led-ambient-opacity': (0.04 + 0.19 * ledBrightness).toFixed(3),
  };
  const handleDx = probe?.x > 700 ? -53 : 53;
  const handleDy = probe?.y < 155 ? 49 : -49;
  const menuPart = selected?.startsWith('wire:') ? 'wire' : selected;
  const menuAnchor = (() => {
    if (!selected) return null;
    if (selected === 'probe') return probe && {
      x: probe.x + handleDx,
      top: Math.min(probe.y - 20, probe.y + handleDy - 30),
      bottom: Math.max(probe.y + 20, probe.y + handleDy + 30),
    };
    if (selected.startsWith('wire:')) {
      const wire = game.wires.find(item => wireKey(...item.split('-')) === selected.slice(5));
      if (!wire) return null;
      const [from, to] = wire.split('-');
      const a = pinPosition(game, from);
      const b = pinPosition(game, to);
      if (!a || !b) return null;
      const y = (a.y + b.y) / 2;
      return { x: (a.x + b.x) / 2, top: y - 14, bottom: y + 14 };
    }
    if (!game.placed[selected]) return null;
    const extents = {
      mcu: [-127, 128], power: [-90, 20], ground: [-12, 95], nodeA: [-48, 30],
      resistor: [-60, 24], led: [-56, 78], r1: [-60, 24], r2: [-60, 24], r3: [-60, 24], r4: [-60, 24],
    };
    const [top, bottom] = extents[selected] || [-28, 28];
    return { x: game.positions[selected].x, top: game.positions[selected].y + top, bottom: game.positions[selected].y + bottom };
  })();
  const menuPosition = (() => {
    if (!menuAnchor) return null;
    const width = Math.min(248, size.width - 12);
    const x = (menuAnchor.x - viewX) / viewWidth * size.width;
    const top = (menuAnchor.top - viewY) / viewHeight * size.height;
    const bottom = (menuAnchor.bottom - viewY) / viewHeight * size.height;
    const below = bottom + 8;
    const above = top - menuHeight - 8;
    const menuTop = below + menuHeight <= size.height - 6 ? below
      : above >= 6 ? above
        : Math.max(6, Math.min(size.height - menuHeight - 6, below));
    return {
      width, left: Math.max(6, Math.min(size.width - width - 6, x - width / 2)),
      top: menuTop,
    };
  })();
  return <><svg ref={svg} className="circuit-board" viewBox={viewBox} role="group" aria-label={level.model === 'resistor-dc-v1' ? '可编辑的直流电阻网络' : '可编辑的 MCU GPIO 驱动 LED 电路'}
    onPointerMove={move} onPointerUp={endMove} onPointerCancel={event => endMove(event, true)} onLostPointerCapture={event => { if (wireDrag.current?.pointerId === event.pointerId) { wireDrag.current = null; setWirePreview(null); } pointerTrace('capture-lost', { pointerId: event.pointerId, part: drag.current?.id }); }} onDragOver={event => event.preventDefault()} onDrop={drop}
    onPointerDown={event => { if (event.target === event.currentTarget) { pointerTrace('background-down', { x: event.clientX, y: event.clientY }); onSelect(null); } }}>
    <defs><pattern id="board-hole-grid" width={boardGrid.step} height={boardGrid.step} patternUnits="userSpaceOnUse"><circle cx={boardGrid.offset} cy={boardGrid.offset} r="2.2" fill="#517b84" opacity=".7" /></pattern></defs>
    <rect x={viewX} y={viewY} width={viewWidth} height={viewHeight} fill="url(#board-hole-grid)" pointerEvents="none" aria-hidden="true" />
    <g className="board-wires">
      {(game.visualWires || game.wires).map(wire => {
        const [from, to] = wire.split('-');
        const key = wireKey(from, to);
        const a = pinPosition(game, from);
        const b = pinPosition(game, to);
        const path = pathFor(a, b, key, from);
        const color = level.circuit.baseWires?.[0] && key === wireKey(...level.circuit.baseWires[0].split('-')) ? 'power'
          : level.circuit.baseWires?.[1] && key === wireKey(...level.circuit.baseWires[1].split('-')) ? 'ground' : 'signal';
        const direction = flowDirection.get(key);
        const flowPath = direction && pathFor(pinPosition(game, direction[0]), pinPosition(game, direction[1]), key, direction[0]);
        const isSuspected = (game.suspectedWires || []).includes(key);
        const diagnosing = (level.circuit.hiddenOpenCandidates?.length || level.circuit.hiddenOpenWires?.length || level.circuit.hiddenShortCandidates?.length) > 0;
        return <g key={key} className={'wire ' + color + (isSuspected ? ' suspected' : '') + (selected === 'wire:' + key ? ' selected' : '')} onClick={event => { event.stopPropagation(); if (mode === 'probe') onProbeChange(snapProbe(game, pointFor(event))); else if (diagnosing) onToggleSuspect(key); else onSelect('wire:' + key); }}>
          <path className="wire-hit" d={path} /><path className="wire-stroke" d={path} />
          {flowPath && <path className="wire-flow" d={flowPath} aria-hidden="true" />}
          {isSuspected && <g className="wire-suspect-mark" transform={'translate(' + Math.round((a.x + b.x) / 2) + ' ' + Math.round((a.y + b.y) / 2) + ')'} aria-hidden="true">
            <circle r="10" /><text textAnchor="middle" dominantBaseline="central">?</text>
          </g>}
        </g>;
      })}
      {wirePreview && <g className={'wire-preview ' + (wirePreview.target ? 'ready' : '')} aria-hidden="true" pointerEvents="none">
        <path d={wirePreview.target
          ? pathFor(pinPosition(game, wirePreview.from), wirePreview.point, wireKey(wirePreview.from, wirePreview.target), wirePreview.from)
          : routePath([pinPosition(game, wirePreview.from), { x: wirePreview.point.x, y: pinPosition(game, wirePreview.from).y }, wirePreview.point])} />
      </g>}
    </g>
    {game.placed.mcu && <g className={'board-mcu board-component ' + (selected === 'mcu' ? 'selected' : '')} role="button" tabIndex={0} aria-label="MCU 参数与操作"
      transform={'translate(' + (game.positions.mcu.x - 176) + ' ' + (game.positions.mcu.y - 337) + ')'}
      onPointerDown={event => startMove(event, 'mcu')} onKeyDown={event => keyboardSelect(event, 'mcu')}>
      <rect x="76" y="210" width="200" height="255" rx="9" />
      <text className="mcu-title" x="176" y="383" textAnchor="middle">MCU</text>
      <text className="port-label" x="252" y="265" textAnchor="end">VDD</text>
      <text className="port-label" x="252" y="342" textAnchor="end">GPIO0</text>
      <text className="port-label" x="252" y="432" textAnchor="end">GND</text>
      <Pin id="mcu.vdd" x={276} y={258} {...pinProps} />
      <Pin id="mcu.gpio" x={276} y={335} {...pinProps} />
      <Pin id="mcu.gnd" x={276} y={425} {...pinProps} />
    </g>}
    {game.placed.power && <g className={'board-power board-component ' + (level.board.fixedParts?.includes('power') ? 'fixed ' : '') + (selected === 'power' ? 'selected' : '')} role="button" tabIndex={0} aria-label="电源参数与操作"
      transform={'translate(' + (game.positions.power.x - 379) + ' ' + (game.positions.power.y - 154) + ')'}
      onPointerDown={event => startMove(event, 'power')} onKeyDown={event => keyboardSelect(event, 'power')}>
      <text x="379" y="91" textAnchor="middle">{(level.electrical.sourceV ?? level.electrical.gpioHighV).toFixed(1)} V</text>
      <circle cx="379" cy="119" r="11" />
      <path d="M379 130v24" />
      <Pin id="power" x={379} y={154} {...pinProps} />
    </g>}
    {game.placed.ground && <g className={'board-ground board-component ' + (level.board.fixedParts?.includes('ground') ? 'fixed ' : '') + (selected === 'ground' ? 'selected' : '')} role="button" tabIndex={0} aria-label="GND 参数与操作"
      transform={'translate(' + (game.positions.ground.x - 790) + ' ' + (game.positions.ground.y - 489) + ')'}
      onPointerDown={event => startMove(event, 'ground')} onKeyDown={event => keyboardSelect(event, 'ground')}>
      <path d="M790 489v26 M765 515h50 M772 526h36 M780 537h20" />
      <text x="790" y="575" textAnchor="middle">GND</text>
      <Pin id="ground" x={790} y={489} {...pinProps} />
    </g>}
    {game.placed.nodeA && <g className={'board-node-a board-component fixed ' + (selected === 'nodeA' ? 'selected' : '')} role="button" tabIndex={0} aria-label="节点 A，固定接线点"
      transform={'translate(' + game.positions.nodeA.x + ' ' + game.positions.nodeA.y + ')'}
      onPointerDown={event => startMove(event, 'nodeA')} onKeyDown={event => keyboardSelect(event, 'nodeA')}>
      <circle className="node-a-halo" r="26" />
      <text className="node-a-label" x="0" y="-35" textAnchor="middle">节点 A</text>
      <Pin id="nodeA" x={0} y={0} {...pinProps} />
    </g>}
    {game.placed.resistor && <g className={'board-component resistor ' + resistorState + ' ' + (selected === 'resistor' ? 'selected' : '')} role="button" tabIndex={0} aria-label={'限流电阻参数与操作，' + (resistorState === 'burst' ? '功率过载' : resistorState === 'conducting' ? '正在通电' : '未通电')}
      transform={'translate(' + resistor.x + ' ' + resistor.y + ')'}
      onPointerDown={event => startMove(event, 'resistor')} onKeyDown={event => keyboardSelect(event, 'resistor')}>
      <text className="value" x="0" y="-39" textAnchor="middle">{game.resistorOhms ? game.resistorOhms + ' Ω' : '待选阻值'}</text>
      <path className="lead" d="M-70 0h30 M40 0h30" />
      <rect x="-40" y="-15" width="80" height="30" rx="7" />
      <path className="bands" d="M-22-14v28 M-8-14v28 M9-14v28 M23-14v28" />
      {resistorState === 'conducting' && <path className="component-flow" d={currentPath.resistorDirection === 'forward' ? 'M-39 0H39' : 'M39 0H-39'} aria-hidden="true" />}
      {resistorState === 'burst' && <g className="resistor-burst-effect" aria-hidden="true"><path d="M-14-15l10 10-8 8 10 12 M8-15l-8 9 10 6-7 15" /><circle cx="-10" cy="-25" r="7" /><circle cx="5" cy="-39" r="9" /><circle cx="16" cy="-53" r="7" /></g>}
      <Pin id="resistor.a" x={-70} y={0} {...pinProps} />
      <Pin id="resistor.b" x={70} y={0} {...pinProps} />
    </g>}
    {[...new Set([...(level.circuit.resistors || []), ...Object.keys(game.placed).filter(id => game.placed[id] && /^r\d+$/.test(id))])].map(id => {
      if (!game.placed[id]) return null;
      const position = game.positions[id];
      const state = componentStates[id]?.state || 'normal';
      const current = componentStates[id]?.currentMa || 0;
      const direction = componentStates[id]?.direction || 'forward';
      return <g key={id} className={'board-component resistor ' + state + ' ' + (selected === id ? 'selected' : '') + (game.suspectedShort === id ? ' suspected' : '')} role="button" tabIndex={0}
        aria-label={id.toUpperCase() + ' 电阻参数与操作，' + (current > 0 ? '正在通电' : '未通电')}
        transform={'translate(' + position.x + ' ' + position.y + ')'}
        onPointerDown={event => startMove(event, id)} onKeyDown={event => keyboardSelect(event, id)}>
        <text className="value" x="0" y="-39" textAnchor="middle">{id.toUpperCase()} · {game.resistorValues?.[id] ? game.resistorValues[id] + ' Ω' : '待选阻值'}</text>
        <path className="lead" d="M-70 0h30 M40 0h30" />
        <rect x="-40" y="-15" width="80" height="30" rx="7" />
        <path className="bands" d="M-22-14v28 M-8-14v28 M9-14v28 M23-14v28" />
        {state === 'conducting' && <path className="component-flow" d={direction === 'forward' ? 'M-39 0H39' : 'M39 0H-39'} aria-hidden="true" />}
        {game.suspectedShort === id && <g className="wire-suspect-mark" transform="translate(0 -64)" aria-hidden="true"><circle r="10" /><text textAnchor="middle" dominantBaseline="central">?</text></g>}
        <Pin id={id + '.a'} x={-70} y={0} {...pinProps} />
        <Pin id={id + '.b'} x={70} y={0} {...pinProps} />
      </g>;
    })}
    {game.placed.led && <g className={'board-component led ' + ledState + ' ' + (selected === 'led' ? 'selected' : '')} role="button" tabIndex={0} aria-label={'LED 参数与操作，' + (ledState === 'lit' ? '电流越大越亮' : ledState === 'burned' ? '过流失效' : '未点亮')}
      transform={'translate(' + led.x + ' ' + led.y + ')'} style={ledVisualStyle}
      onPointerDown={event => startMove(event, 'led')} onKeyDown={event => keyboardSelect(event, 'led')}>
      <circle className="led-ambient-glow" cx="-4" cy="0" r="47" aria-hidden="true" />
      <path className="lead" d="M-61 0h27 M29 0h32" />
      <g transform={game.reversed ? 'scale(-1 1)' : undefined}>
        <path className="led-symbol" d="M-34-25v50 L25 0 Z M29-28v56" />
        <path className="led-rays" d="M-5-36l8-15 M13-36l8-15" />
      </g>
      {failureEffect === 'overcurrent' && <g className="burn-puff" aria-hidden="true">
        <circle cx="-9" cy="-38" r="7" /><circle cx="5" cy="-53" r="9" /><circle cx="15" cy="-70" r="8" />
      </g>}
      <text className="polarity-label" x="-61" y="32" textAnchor="middle">{game.reversed ? 'K' : 'A'}</text>
      <text className="polarity-label" x="61" y="32" textAnchor="middle">{game.reversed ? 'A' : 'K'}</text>
      <text className="value" x="0" y="67" textAnchor="middle">LED</text>
      <Pin id="led.a" x={-61} y={0} {...pinProps} />
      <Pin id="led.b" x={61} y={0} {...pinProps} />
    </g>}
    {probe && <g className={'board-probe ' + (probe.target ? 'attached' : 'free')} transform={'translate(' + probe.x + ' ' + probe.y + ')'} role="button" tabIndex={0} aria-label="探针参数与操作" onPointerUp={event => { if (!probeDrag.current) { event.stopPropagation(); onSelect('probe'); } }} onKeyDown={event => keyboardSelect(event, 'probe')}>
      <circle className="probe-tip-halo" r="20" />
      <circle className="probe-tip" r="7" />
      <path className="probe-arm" d={'M0 0L' + handleDx + ' ' + handleDy} />
      <circle className="probe-grip" cx={handleDx} cy={handleDy} r="23" role="button" tabIndex={0} aria-label="拖动测量探针查看电压和支路电流，或用方向键移动" onPointerDown={startProbeMove}
        onKeyDown={event => {
          const offsets = { ArrowLeft: [-55, 0], ArrowRight: [55, 0], ArrowUp: [0, -55], ArrowDown: [0, 55] };
          const offset = offsets[event.key];
          if (offset) { event.preventDefault(); onProbeChange(snapProbe(game, { x: probe.x + offset[0], y: probe.y + offset[1] })); }
        }} />
      <text className="probe-grip-mark" x={handleDx} y={handleDy + 7} textAnchor="middle">V</text>
    </g>}
    {(failureEffect === 'gpio-short' || failureEffect === 'supply-short') && <g className="board-spark" transform={'translate(' + (failureEffect === 'gpio-short' ? pinPosition(game, 'mcu.gpio').x + ' ' + pinPosition(game, 'mcu.gpio').y : game.positions.power.x + ' ' + game.positions.power.y) + ')'} aria-hidden="true">
      <circle cx="0" cy="0" r="22" /><path d="M0-32v-12 M0 32v12 M-32 0h-12 M32 0h12 M-23-23l-9-9 M23 23l9 9" />
    </g>}
  </svg>{menuPosition && <div ref={menuRef} className="board-menu-overlay" style={menuPosition}><PartParameterMenu key={selected} id={menuPart} level={level} game={game} componentState={componentStates[menuPart]} onChooseResistor={onChooseResistor} onFlipLed={onFlipLed} onRemove={level.board.fixedParts?.includes(menuPart) ? null : onRemoveSelected} onClose={() => onSelect(null)} /></div>}</>;
}
