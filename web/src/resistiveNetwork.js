// Ideal-wire, DC resistor network model. One shared solver supports arbitrary
// resistor connections; a level supplies only its parts and target metrics.
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
  const terminals = [level.circuit.source, level.circuit.nodeA, level.circuit.ground,
    ...level.circuit.resistors.flatMap(id => [`${id}.a`, `${id}.b`])]
    .filter(terminal => game.placed[partOf(terminal)]);
  const parent = new Map(terminals.map(terminal => [terminal, terminal]));
  const root = terminal => {
    if (!parent.has(terminal)) return null;
    if (parent.get(terminal) !== terminal) parent.set(terminal, root(parent.get(terminal)));
    return parent.get(terminal);
  };
  const wires = game.wires.map(wire => wire.split('-')).filter(([a, b]) => parent.has(a) && parent.has(b));
  for (const [a, b] of wires) parent.set(root(b), root(a));
  const source = root(level.circuit.source);
  const ground = root(level.circuit.ground);
  const shorted = Boolean(source && ground && source === ground);
  const resistors = level.circuit.resistors.map(id => ({
    id, a: root(`${id}.a`), b: root(`${id}.b`), ohms: game.resistorValues?.[id] ?? null,
  })).filter(item => item.a && item.b && finite(item.ohms) && item.ohms > 0);
  const nodes = [...new Set(terminals.map(root))];
  const voltages = new Map();
  if (source && !shorted) voltages.set(source, level.electrical.sourceV);
  if (ground && !shorted) voltages.set(ground, 0);

  if (!shorted) {
    const adjacent = new Map(nodes.map(node => [node, new Set()]));
    for (const resistor of resistors) {
      adjacent.get(resistor.a).add(resistor.b);
      adjacent.get(resistor.b).add(resistor.a);
    }
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
      const solved = solveLinear(matrix, values);
      solved?.forEach((value, index) => voltages.set(unknown[index], value));
    }
  }

  const resistorResults = Object.fromEntries(level.circuit.resistors.map(id => [id, {
    ohms: game.resistorValues?.[id] ?? null, currentMa: null, powerW: null, direction: 'forward',
  }]));
  for (const item of resistors) {
    const va = voltages.get(item.a);
    const vb = voltages.get(item.b);
    if (!finite(va) || !finite(vb)) continue;
    const rawCurrentMa = (va - vb) / item.ohms * 1000;
    const signedCurrentMa = Math.abs(rawCurrentMa) < 1e-9 ? 0 : rawCurrentMa;
    resistorResults[item.id] = {
      ohms: item.ohms, currentMa: Math.abs(signedCurrentMa), signedCurrentMa,
      powerW: (signedCurrentMa / 1000) ** 2 * item.ohms,
      direction: signedCurrentMa >= 0 ? 'forward' : 'reverse',
    };
  }
  const totalCurrentMa = shorted || !source ? null : resistors.reduce((sum, item) => {
    const current = resistorResults[item.id].signedCurrentMa;
    if (!finite(current)) return sum;
    return sum + (item.a === source ? current : 0) - (item.b === source ? current : 0);
  }, 0);
  const kclErrorMa = nodes.reduce((largest, node) => {
    const outgoing = resistors.reduce((sum, item) => {
      const current = resistorResults[item.id].signedCurrentMa;
      if (!finite(current)) return sum;
      return sum + (item.a === node ? current : 0) - (item.b === node ? current : 0);
    }, 0);
    const sourceInjection = node === source ? totalCurrentMa : node === ground ? -totalCurrentMa : 0;
    return Math.max(largest, Math.abs(outgoing - (sourceInjection || 0)));
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
  if (finite(totalCurrentMa)) {
    injections.set(level.circuit.source, injections.get(level.circuit.source) + totalCurrentMa);
    injections.set(level.circuit.ground, injections.get(level.circuit.ground) - totalCurrentMa);
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
  return {
    shorted, voltageAt, resistorResults, wireCurrents,
    nodeAV: voltageAt(level.circuit.nodeA),
    totalCurrentMa,
    equivalentOhms: finite(totalCurrentMa) && totalCurrentMa > 1e-9
      ? level.electrical.sourceV / (totalCurrentMa / 1000) : null,
    ...Object.fromEntries(level.circuit.resistors.map(id => [`${id}CurrentMa`, resistorResults[id]?.currentMa ?? null])),
    ...Object.fromEntries(level.circuit.resistors.map(id => [`${id}DropV`,
      finite(voltageAt(`${id}.a`)) && finite(voltageAt(`${id}.b`))
        ? Math.abs(voltageAt(`${id}.a`) - voltageAt(`${id}.b`)) : null])),
    kclErrorMa,
    allSelected: level.circuit.resistors.every(id => finite(game.resistorValues?.[id])),
  };
}
