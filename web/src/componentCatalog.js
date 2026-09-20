// Shared terminal geometry for the board, snapping and level validation.
// A new physical component is registered once here and given one visual/model
// implementation; levels then reference its id and parameters.
const resistorGeometry = Object.freeze({ visualBounds: [-72, 72, -60, 24] });
const resistorTerminals = id => ({ [`${id}.a`]: { x: -70, y: 0 }, [`${id}.b`]: { x: 70, y: 0 } });

export const componentCatalog = Object.freeze({
  mcu: {
    bounds: [105, 685, 260, 480],
    visualBounds: [-100, 100, -127, 128],
    terminals: { 'mcu.vdd': { x: 100, y: -79 }, 'mcu.gpio': { x: 100, y: -2 }, 'mcu.gnd': { x: 100, y: 88 } },
  },
  power: { visualBounds: [-45, 45, -90, 20], terminals: { power: { x: 0, y: 0 } } },
  // Ideal current source: fixed current leaves `isource.out` and returns to
  // `isource.in`; its terminal voltage is set by the connected network.
  // The box reaches up to the "6 mA 恒定" label drawn above the symbol: a wire
  // through the label looks as wrong as a wire through the circle, so the routing
  // ink has to cover it too.
  isource: { visualBounds: [-72, 72, -74, 34], terminals: { 'isource.in': { x: -55, y: 0 }, 'isource.out': { x: 55, y: 0 } } },
  // Voltage-controlled current source (diamond symbol): its output current is
  // g·U_control and it pulls the same current back at `in`, so it can never
  // excite a circuit on its own — a zero control voltage means zero output.
  vccs: { visualBounds: [-72, 72, -74, 34], terminals: { 'vccs.in': { x: -55, y: 0 }, 'vccs.out': { x: 55, y: 0 } } },
  ground: { visualBounds: [-48, 48, -12, 95], terminals: { ground: { x: 0, y: 0 } } },
  nodeA: { visualBounds: [-30, 30, -48, 30], terminals: { nodeA: { x: 0, y: 0 } } },
  // A second named reference point (e.g. the tap of a divider). Same shape as
  // node A, one per level at most.
  nodeB: { visualBounds: [-30, 30, -48, 30], terminals: { nodeB: { x: 0, y: 0 } } },
  resistor: { ...resistorGeometry, terminals: resistorTerminals('resistor') },
  led: { visualBounds: [-63, 63, -56, 78], terminals: { 'led.a': { x: -61, y: 0 }, 'led.b': { x: 61, y: 0 } } },
});

const dynamicSpecs = new Map();

// Libraries the player can drop without a count limit. Each family declares the
// id pattern and how to build one instance's terminals, so a sandbox level never
// depends on a fixed list of instance ids. Add a row here once per new family
// (for example capacitors as `/^c\d+$/`) instead of enumerating instances.
const dynamicFamilies = [
  {
    pattern: /^r\d+$/,
    build: id => ({ visualBounds: [-72, 72, -60, 24], terminals: { [`${id}.a`]: { x: -70, y: 0 }, [`${id}.b`]: { x: 70, y: 0 } } }),
  },
];

// Every component lookup goes through this resolver: a fifth resistor, or a
// hundredth, behaves exactly like the first instead of crashing the board.
export function componentSpec(id) {
  const known = componentCatalog[id];
  if (known) return known;
  if (typeof id !== 'string') return undefined;
  const cached = dynamicSpecs.get(id);
  if (cached) return cached;
  const family = dynamicFamilies.find(item => item.pattern.test(id));
  if (!family) return undefined;
  const spec = family.build(id);
  dynamicSpecs.set(id, spec);
  return spec;
}

export const boardToolIds = Object.freeze(['wire', 'probe']);

// The single source of truth for naming a newly dropped library part: the
// lowest free instance id, so deleting R2 and placing again reuses R2. There is
// no upper bound — a sandbox board can hold as many resistors as the player
// drops.
export function nextResistorId(placed = {}) {
  const used = new Set(Object.keys(placed).filter(id => placed[id] && /^r\d+$/.test(id)));
  let number = 1;
  while (used.has('r' + number)) number += 1;
  return 'r' + number;
}
