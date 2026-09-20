// Ideal-wire, DC resistor network model. One shared solver supports arbitrary
// resistor connections and either an ideal voltage source (a fixed node voltage)
// or an ideal current source (a fixed node current injection). A level supplies
// only its parts and target metrics.
const keyOf = (a, b) => [a, b].sort().join('-');
const partOf = terminal => terminal.split('.')[0];
const finite = value => Number.isFinite(value);

function solveLinear(matrix, values) {
  const rows = matrix.map((row, index) => [...row, values[index]]);
  for (let column = 0; column < rows.length; column++) {
    let pivot = column;
    for (let row = column + 1; row < rows.length; row++) {
      if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot = row;
    }
    if (Math.abs(rows[pivot][column]) < 1e-12) return null;
    [rows[column], rows[pivot]] = [rows[pivot], rows[column]];
    const scale = rows[column][column];
    for (let col = column; col <= rows.length; col++) rows[column][col] /= scale;
    for (let row = 0; row < rows.length; row++) {
      if (row === column) continue;
      const factor = rows[row][column];
      for (let col = column; col <= rows.length; col++) rows[row][col] -= factor * rows[column][col];
    }
  }
  return rows.map(row => row.at(-1));
}

export function solveResistiveNetwork(game, level) {
  // Player may drop more resistors than the declared slots (r1, r2, r3...):
  // treat every placed rN component as a network resistor.
  const voltageSource = level.circuit.source || null;
  const currentSource = level.circuit.currentSource || null;
  // A voltage-controlled current source: its output current is g·U_control, so it
  // is not an independent excitation — no control voltage, no output.
  const controlledSource = level.circuit.controlledSource || null;
  // The transconductance can be a knob the player turns, so the runtime value in
  // the game state wins over the level's reference value.
  const gmMs = game.controlledGmMs ?? level.electrical.controlledTransconductanceMs ?? 0;
  const gmSiemens = controlledSource ? gmMs / 1000 : 0;
  const sourceTerminals = [
    ...(currentSource ? [currentSource.out, currentSource.in] : []),
    ...(controlledSource ? [controlledSource.out, controlledSource.in] : []),
  ];
  const placedResistorIds = Object.keys(game.placed)
    .filter(id => game.placed[id] && /^r\d+$/.test(id));
  const resistorIds = [...new Set([...(level.circuit.resistors || []).filter(id => game.placed[id]), ...placedResistorIds])];
  const terminals = [voltageSource, level.circuit.nodeA, level.circuit.nodeB, level.circuit.ground, ...sourceTerminals,
    ...(controlledSource ? [controlledSource.control.positive, controlledSource.control.negative] : []),
    ...resistorIds.flatMap(id => [`${id}.a`, `${id}.b`])]
    .filter(terminal => terminal && game.placed[partOf(terminal)]);
  const parent = new Map(terminals.map(terminal => [terminal, terminal]));
  const root = terminal => {
    if (!parent.has(terminal)) return null;
    if (parent.get(terminal) !== terminal) parent.set(terminal, root(parent.get(terminal)));
    return parent.get(terminal);
  };
  const wires = game.wires.map(wire => wire.split('-')).filter(([a, b]) => parent.has(a) && parent.has(b));
  for (const [a, b] of wires) parent.set(root(b), root(a));
  const source = voltageSource ? root(voltageSource) : null;
  const ground = root(level.circuit.ground);
  const outNode = currentSource ? root(currentSource.out) : null;
  const inNode = currentSource ? root(currentSource.in) : null;
  const controlledOutNode = controlledSource ? root(controlledSource.out) : null;
  const controlledInNode = controlledSource ? root(controlledSource.in) : null;
  const controlPositiveNode = controlledSource ? root(controlledSource.control.positive) : null;
  const controlNegativeNode = controlledSource ? root(controlledSource.control.negative) : null;
  // Two operating points cannot be solved: a voltage source held across ideal
  // wires (its current is unbounded), or a current source with both terminals on
  // one node (its voltage is unbounded).
  const shorted = Boolean(source && ground && source === ground);
  const currentSourceShorted = Boolean(currentSource && outNode && inNode && outNode === inNode);
  const unsolvable = shorted || currentSourceShorted;
  const resistors = resistorIds.map(id => ({
    id, a: root(`${id}.a`), b: root(`${id}.b`), ohms: game.resistorValues?.[id] ?? null,
  })).filter(item => item.a && item.b && finite(item.ohms) && item.ohms > 0);
  const nodes = [...new Set(terminals.map(root))];
  // Connectivity through resistors: wires already merged their endpoints above.
  const adjacent = new Map(nodes.map(node => [node, new Set()]));
  for (const resistor of resistors) {
    if (resistor.a === resistor.b) continue;
    adjacent.get(resistor.a).add(resistor.b);
    adjacent.get(resistor.b).add(resistor.a);
  }
  const componentOf = new Map();
  let componentCount = 0;
  for (const node of nodes) {
    if (componentOf.has(node)) continue;
    const queue = [node];
    componentOf.set(node, componentCount);
    for (const current of queue) {
      for (const next of adjacent.get(current)) {
        if (!componentOf.has(next)) { componentOf.set(next, componentCount); queue.push(next); }
      }
    }
    componentCount += 1;
  }
  const sameComponent = (a, b) => a !== null && b !== null &&
    componentOf.get(a) !== undefined && componentOf.get(a) === componentOf.get(b);
  // An ideal current source only forces its current when the loop is closed back
  // on itself and tied to the reference node; otherwise nothing conducts and the
  // model must not push the nominal current into an island.
  const currentSourceClosed = Boolean(currentSource) && sameComponent(outNode, inNode) && sameComponent(outNode, ground);
  const unresolved = Boolean(currentSource) && !currentSourceShorted && !currentSourceClosed;
  // A controlled source is not an independent excitation: it drives the network
  // only when it and its control branch sit on the same conducting island as the
  // reference node. Otherwise its output is nothing, not the nominal value.
  const controlledSourceActive = Boolean(controlledSource) && !unsolvable &&
    sameComponent(controlledOutNode, controlledInNode) && sameComponent(controlledOutNode, ground) &&
    sameComponent(controlPositiveNode, ground);
  const voltages = new Map();
  // Current injected into each node, in amperes, by an ideal current source.
  const injectedAmps = new Map();
  if (!unsolvable && source) voltages.set(source, level.electrical.sourceV);
  if (!unsolvable && ground) voltages.set(ground, 0);
  if (!unsolvable && currentSource && currentSourceClosed) {
    const currentA = level.electrical.sourceCurrentMa / 1000;
    injectedAmps.set(outNode, (injectedAmps.get(outNode) || 0) + currentA);
    injectedAmps.set(inNode, (injectedAmps.get(inNode) || 0) - currentA);
  }

  if (!unsolvable) {
    const seen = new Set();
    for (const node of nodes) {
      if (seen.has(node)) continue;
      const group = [];
      const queue = [node];
      seen.add(node);
      for (const current of queue) {
        group.push(current);
        for (const next of adjacent.get(current)) if (!seen.has(next)) { seen.add(next); queue.push(next); }
      }
      if (!group.some(item => voltages.has(item))) continue;
      const unknown = group.filter(item => !voltages.has(item));
      if (!unknown.length) continue;
      const index = new Map(unknown.map((item, position) => [item, position]));
      const matrix = unknown.map(() => unknown.map(() => 0));
      const values = unknown.map(() => 0);
      for (const { a, b, ohms } of resistors) {
        if (a === b) continue;
        const conductance = 1 / ohms;
        for (const [at, other] of [[a, b], [b, a]]) {
          const row = index.get(at);
          if (row === undefined) continue;
          matrix[row][row] += conductance;
          const col = index.get(other);
          if (col === undefined) values[row] += conductance * voltages.get(other);
          else matrix[row][col] -= conductance;
        }
      }
      // The controlled source's output current g·(V+ − V−) depends on unknowns,
      // so it moves to the left-hand side of the node equation: the current it
      // pushes into `out` and pulls out of `in` becomes a pair of coefficients.
      if (controlledSourceActive) {
        const addCoefficient = (row, node, coefficient) => {
          if (row === undefined || !node || coefficient === 0) return;
          const column = index.get(node);
          if (column === undefined) values[row] -= coefficient * voltages.get(node);
          else matrix[row][column] += coefficient;
        };
        for (const [at, sign] of [[controlledOutNode, -1], [controlledInNode, 1]]) {
          const row = index.get(at);
          addCoefficient(row, controlPositiveNode, sign * gmSiemens);
          addCoefficient(row, controlNegativeNode, -sign * gmSiemens);
        }
      }
      unknown.forEach((item, position) => { values[position] += injectedAmps.get(item) || 0; });
      const solved = solveLinear(matrix, values);
      solved?.forEach((value, index) => voltages.set(unknown[index], value));
    }
  }

  const resistorResults = Object.fromEntries(resistorIds.map(id => [id, {
    ohms: game.resistorValues?.[id] ?? null, currentMa: null, powerW: null, direction: 'forward', bypassed: false,
  }]));
  for (const item of resistors) {
    const va = voltages.get(item.a);
    const vb = voltages.get(item.b);
    if (!finite(va) || !finite(vb)) continue;
    const rawCurrentMa = (va - vb) / item.ohms * 1000;
    const signedCurrentMa = Math.abs(rawCurrentMa) < 1e-9 ? 0 : rawCurrentMa;
    resistorResults[item.id] = {
      ohms: item.ohms, currentMa: Math.abs(signedCurrentMa), signedCurrentMa,
      // Each part carries its own rating: the player can choose a ½ W part
      // instead of splitting the current between two ¼ W parts.
      ratedPowerW: game.resistorRatings?.[item.id] ?? level.electrical.resistorRatedPowerW,
      powerW: (signedCurrentMa / 1000) ** 2 * item.ohms,
      direction: signedCurrentMa >= 0 ? 'forward' : 'reverse',
      bypassed: item.a === item.b,
      // Both ends on the reference island: a branch can legitimately carry no
      // current (a node held at the source potential) without being dangling.
      connected: sameComponent(item.a, ground) && sameComponent(item.b, ground),
    };
  }
  // Control voltage and the output current it produces, in the units the level
  // and the UI speak: volts and milliamps.
  const controlledControlV = controlledSourceActive &&
    finite(voltages.get(controlPositiveNode)) && finite(voltages.get(controlNegativeNode))
    ? voltages.get(controlPositiveNode) - voltages.get(controlNegativeNode) : null;
  const controlledCurrentMa = Number.isFinite(controlledControlV) ? controlledControlV * gmSiemens * 1000 : null;
  const deliveredNode = source || outNode;
  const totalCurrentMa = unsolvable || !deliveredNode ? null : resistors.reduce((sum, item) => {
    const current = resistorResults[item.id].signedCurrentMa;
    if (!finite(current)) return sum;
    return sum + (item.a === deliveredNode ? current : 0) - (item.b === deliveredNode ? current : 0);
  }, 0);
  // A voltage source sets the voltage and lets the network set its current; a
  // current source does the opposite. Both may act on the same network, so each
  // one reports the quantity the other kind fixes.
  // What the voltage source really delivers: what leaves its node through
  // resistors, plus what a current source wired onto that same node draws from it
  // (or returns to it). Without this term a current source sharing the source node
  // would make the source's own power — and the whole power balance — wrong.
  const currentSourceShareMa = currentSource && currentSourceClosed && source
    ? (inNode === source ? level.electrical.sourceCurrentMa : 0)
      - (outNode === source ? level.electrical.sourceCurrentMa : 0)
    : 0;
  const controlledShareMa = controlledSourceActive && source
    ? (controlledInNode === source ? controlledCurrentMa : 0)
      - (controlledOutNode === source ? controlledCurrentMa : 0)
    : 0;
  const sourceNodeShareMa = currentSourceShareMa + controlledShareMa;
  const voltageSourceCurrentMa = source && finite(totalCurrentMa) ? totalCurrentMa + sourceNodeShareMa : null;
  // Read the solved node voltages directly: `voltageAt` is defined further down.
  const currentSourceVoltageV = !unsolvable && currentSource &&
    finite(voltages.get(outNode)) && finite(voltages.get(inNode))
    ? voltages.get(outNode) - voltages.get(inNode) : null;
  // Every active source injects a known current into one node and takes it back
  // at the other; the summed voltage drops around each node must balance them.
  const sourceInjections = new Map();
  const addInjection = (node, currentMa) => {
    if (node == null || !finite(currentMa)) return;
    sourceInjections.set(node, (sourceInjections.get(node) || 0) + currentMa);
  };
  if (source && finite(voltageSourceCurrentMa)) {
    addInjection(source, voltageSourceCurrentMa);
    addInjection(ground, -voltageSourceCurrentMa);
  }
  if (currentSource && currentSourceClosed) {
    addInjection(outNode, level.electrical.sourceCurrentMa);
    addInjection(inNode, -level.electrical.sourceCurrentMa);
  }
  if (controlledSourceActive) {
    addInjection(controlledOutNode, controlledCurrentMa);
    addInjection(controlledInNode, -controlledCurrentMa);
  }
  const kclErrorMa = nodes.reduce((largest, node) => {
    const outgoing = resistors.reduce((sum, item) => {
      const current = resistorResults[item.id].signedCurrentMa;
      if (!finite(current)) return sum;
      return sum + (item.a === node ? current : 0) - (item.b === node ? current : 0);
    }, 0);
    return Math.max(largest, Math.abs(outgoing - (sourceInjections.get(node) || 0)));
  }, 0);

  // Current on ideal wire branches is derived from KCL on a spanning tree.
  // Ideal wire loops have no unique branch-current split, so unused cycle edges
  // deliberately show no estimated flow.
  const injections = new Map(terminals.map(terminal => [terminal, 0]));
  for (const item of resistors) {
    const current = resistorResults[item.id].signedCurrentMa;
    if (!finite(current)) continue;
    injections.set(`${item.id}.a`, injections.get(`${item.id}.a`) - current);
    injections.set(`${item.id}.b`, injections.get(`${item.id}.b`) + current);
  }
  const addTerminalInjection = (terminal, currentMa) => {
    if (terminal == null || !finite(currentMa)) return;
    injections.set(terminal, (injections.get(terminal) || 0) + currentMa);
  };
  if (voltageSource && finite(voltageSourceCurrentMa)) {
    addTerminalInjection(voltageSource, voltageSourceCurrentMa);
    addTerminalInjection(level.circuit.ground, -voltageSourceCurrentMa);
  }
  if (controlledSourceActive) {
    addTerminalInjection(controlledSource.out, controlledCurrentMa);
    addTerminalInjection(controlledSource.in, -controlledCurrentMa);
  }
  if (currentSource && currentSourceClosed) {
    addTerminalInjection(currentSource.out, level.electrical.sourceCurrentMa);
    addTerminalInjection(currentSource.in, -level.electrical.sourceCurrentMa);
  }
  const wireCurrents = {};
  for (const node of nodes) {
    const vertices = terminals.filter(terminal => root(terminal) === node);
    const neighbors = new Map(vertices.map(terminal => [terminal, []]));
    for (const [a, b] of wires) if (root(a) === node && root(b) === node) {
      neighbors.get(a).push(b); neighbors.get(b).push(a);
    }
    const visited = new Set();
    const walk = (at, parentTerminal = null) => {
      visited.add(at);
      let balance = injections.get(at) || 0;
      for (const next of neighbors.get(at)) {
        if (next === parentTerminal || visited.has(next)) continue;
        const childBalance = walk(next, at);
        if (Math.abs(childBalance) > 1e-8) {
          wireCurrents[keyOf(at, next)] = {
            currentMa: Math.abs(childBalance),
            from: childBalance > 0 ? next : at,
            to: childBalance > 0 ? at : next,
          };
        }
        balance += childBalance;
      }
      return balance;
    };
    vertices.forEach(terminal => { if (!visited.has(terminal)) walk(terminal); });
  }
  const voltageAt = terminal => voltages.get(root(terminal)) ?? null;

  // Branches leaving the measured node towards the reference point: a resistor
  // attached to node A whose far side still reaches GND once node A's net is
  // removed. This is what "并联支路" means electrically, so it ignores anything
  // in series with the source (which changes the source's terminal voltage, not
  // the current) and treats a series chain as the single branch it is.
  const nodeANet = root(level.circuit.nodeA);
  const groundNet = root(level.circuit.ground);
  const reachesGroundWithoutNodeA = start => {
    if (start == null || start === nodeANet) return false;
    const seen = new Set([nodeANet, start]);
    const queue = [start];
    for (const current of queue) {
      if (current === groundNet) return true;
      for (const item of resistors) {
        const next = item.a === current ? item.b : item.b === current ? item.a : null;
        if (next == null || seen.has(next)) continue;
        seen.add(next);
        queue.push(next);
      }
    }
    return false;
  };
  const branchResults = resistors
    .filter(item => (item.a === nodeANet || item.b === nodeANet)
      && reachesGroundWithoutNodeA(item.a === nodeANet ? item.b : item.a))
    .map(item => ({ id: item.id, currentMa: resistorResults[item.id]?.currentMa ?? null }))
    .filter(item => finite(item.currentMa));
  // Resistors that carry the source into the measured node instead of leaving it:
  // they are the series elements a student may put in front of node A.
  const sourceSeriesIds = [];
  const seriesSeen = new Set();
  if (voltageSource === null && currentSource && outNode != null && nodeANet != null && outNode !== nodeANet) {
    const visited = new Set([outNode]);
    const queue = [outNode];
    const collect = id => { if (!seriesSeen.has(id)) { seriesSeen.add(id); sourceSeriesIds.push(id); } };
    for (const current of queue) {
      for (const item of resistors) {
        const next = item.a === current ? item.b : item.b === current ? item.a : null;
        if (next == null || next === groundNet) continue;
        if (next === nodeANet) { collect(item.id); continue; }
        if (visited.has(next)) continue;
        visited.add(next);
        queue.push(next);
        collect(item.id);
      }
    }
  }
  // Signed power of every element under one stated convention (the one the level
  // draws on the board): P = U·I with current entering the terminal marked "+",
  // so a positive value means the element ABSORBS power. A resistor always absorbs
  // (P = I²R); a source reports negative when it delivers and positive when the
  // network charges it — that sign is the whole point of the first chapter.
  const elementPowerMw = {};
  for (const id of resistorIds) {
    const item = resistorResults[id];
    elementPowerMw[id] = finite(item?.powerW) ? item.powerW * 1000 : null;
  }
  if (voltageSource) {
    elementPowerMw[partOf(voltageSource)] = finite(voltageSourceCurrentMa)
      ? -level.electrical.sourceV * voltageSourceCurrentMa : null;
  }
  if (currentSource) {
    elementPowerMw[currentSource.id] = currentSourceClosed && finite(currentSourceVoltageV)
      ? -currentSourceVoltageV * level.electrical.sourceCurrentMa : null;
  }
  if (controlledSource) {
    elementPowerMw[controlledSource.id] = controlledSourceActive && finite(controlledCurrentMa)
      && finite(voltages.get(controlledOutNode)) && finite(voltages.get(controlledInNode))
      ? -(voltages.get(controlledOutNode) - voltages.get(controlledInNode)) * controlledCurrentMa : null;
  }
  return {
    shorted, currentSourceShorted, unresolved, voltageAt, resistorResults, wireCurrents,
    elementPowerMw,
    nodeAV: voltageAt(level.circuit.nodeA),
    // A level may name a second node (e.g. a divider tap) so goals can read it.
    nodeBV: level.circuit.nodeB ? voltageAt(level.circuit.nodeB) : null,
    totalCurrentMa,
    sourceCurrentMa: finite(level.electrical.sourceCurrentMa) ? level.electrical.sourceCurrentMa : null,
    voltageSourceCurrentMa,
    currentSourceVoltageV,
    controlledSourceCurrentMa: controlledSourceActive ? controlledCurrentMa : null,
    controlledSourceControlV: controlledControlV,
    controlledTransconductanceMs: controlledSource ? gmMs : null,
    // Resistance seen by the active source: its terminal voltage over its current.
    // Two active sources make that ratio meaningless, so it is reported as null.
    // With two active sources — or a controlled source, whose contribution follows
    // the network instead of the source — the terminal ratio no longer describes a
    // passive equivalent resistance.
    equivalentOhms: voltageSource && (currentSource || controlledSourceActive) ? null
      : finite(totalCurrentMa) && Math.abs(totalCurrentMa) > 1e-9
        ? (voltageSource ? level.electrical.sourceV : voltageAt(level.circuit.nodeA)) / (totalCurrentMa / 1000) : null,
    ...Object.fromEntries(resistorIds.map(id => [`${id}CurrentMa`, resistorResults[id]?.currentMa ?? null])),
    // Power per resistor in mW, so a level can state a power goal in the same
    // units the feedback and the rated values use.
    ...Object.fromEntries(resistorIds.map(id => [`${id}PowerMw`,
      Number.isFinite(resistorResults[id]?.powerW) ? resistorResults[id].powerW * 1000 : null])),
    ...Object.fromEntries(resistorIds.map(id => [`${id}DropV`,
      finite(voltageAt(`${id}.a`)) && finite(voltageAt(`${id}.b`))
        ? Math.abs(voltageAt(`${id}.a`) - voltageAt(`${id}.b`)) : null])),
    kclErrorMa,
    branchCurrentsMa: branchResults.map(item => item.currentMa),
    branchIds: branchResults.map(item => item.id),
    sourceSeriesIds,
    // Total current leaving node A through its resistor branches: the "out" side
    // of KCL at the measured node, independent of how those branches are built.
    branchTotalCurrentMa: branchResults.length
      ? branchResults.reduce((sum, item) => sum + item.currentMa, 0) : null,
    // Whether the current source is wired straight onto node A (either terminal),
    // which is what makes its current part of the node's KCL.
    currentSourceTouchesNodeA: Boolean(currentSource) && (outNode === nodeANet || inNode === nodeANet),
    allSelected: resistorIds.filter(id => game.placed[id]).every(id => finite(game.resistorValues?.[id])),
  };
}
