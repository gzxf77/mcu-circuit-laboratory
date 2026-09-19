// Shared terminal geometry for the board, snapping and level validation.
// A new physical component is registered once here and given one visual/model
// implementation; levels then reference its id and parameters.
export const componentCatalog = Object.freeze({
  mcu: {
    bounds: [105, 685, 260, 480],
    visualBounds: [-100, 100, -127, 128],
    terminals: { 'mcu.vdd': { x: 100, y: -79 }, 'mcu.gpio': { x: 100, y: -2 }, 'mcu.gnd': { x: 100, y: 88 } },
  },
  power: { visualBounds: [-45, 45, -90, 20], terminals: { power: { x: 0, y: 0 } } },
  ground: { visualBounds: [-48, 48, -12, 95], terminals: { ground: { x: 0, y: 0 } } },
  nodeA: { visualBounds: [-30, 30, -48, 30], terminals: { nodeA: { x: 0, y: 0 } } },
  resistor: { visualBounds: [-72, 72, -60, 24], terminals: { 'resistor.a': { x: -70, y: 0 }, 'resistor.b': { x: 70, y: 0 } } },
  ...Object.fromEntries(['r1', 'r2', 'r3', 'r4'].map(id => [id, {
    visualBounds: [-72, 72, -60, 24],
    terminals: { [`${id}.a`]: { x: -70, y: 0 }, [`${id}.b`]: { x: 70, y: 0 } },
  }])),
  led: { visualBounds: [-63, 63, -56, 78], terminals: { 'led.a': { x: -61, y: 0 }, 'led.b': { x: 61, y: 0 } } },
});

export const boardToolIds = Object.freeze(['wire', 'probe']);
