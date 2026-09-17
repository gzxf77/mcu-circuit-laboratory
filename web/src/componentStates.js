// Component state is derived from the same electrical report used by goals,
// the probe and current animation. Add one resolver per reusable part family.
export function estimateLedVisualBrightness(currentMa, fullScaleMa) {
  if (!Number.isFinite(currentMa) || currentMa <= 0 || !Number.isFinite(fullScaleMa) || fullScaleMa <= 0) return 0;
  // The square root approximates perceived brightness; this is a visual scale,
  // not a luminous-intensity or LED safety calculation.
  return Math.sqrt(Math.min(currentMa / fullScaleMa, 1));
}

export const componentStateModels = Object.freeze({
  resistor: ({ game, report, level }) => {
    const ratedPowerW = level.electrical.resistorRatedPowerW;
    if (!game.placed.resistor) return { state: 'unplaced', currentMa: 0, powerW: 0, ratedPowerW };
    if (report.resistorFailure) return {
      state: 'burst', currentMa: null, powerW: report.resistorFailure.powerW, ratedPowerW,
    };
    const currentMa = report.currentPath?.currentMa ?? 0;
    return {
      state: currentMa > 0 ? 'conducting' : 'normal', currentMa,
      powerW: report.currentPath?.resistorPowerW ?? 0, ratedPowerW,
    };
  },
  led: ({ game, report, level }) => {
    if (!game.placed.led) return { state: 'unplaced', currentMa: 0, brightness: 0 };
    if (report.ledState === 'burned') return { state: 'burned', currentMa: null, brightness: 0 };
    const currentMa = report.ledState === 'on' && report.currentPath?.kind === 'led-series'
      ? report.currentPath.currentMa : 0;
    const brightness = estimateLedVisualBrightness(currentMa, level.electrical.ledVisualFullScaleMa);
    return { state: brightness > 0 ? 'lit' : 'normal', currentMa, brightness };
  },
});

export function resolveComponentStates(game, level, report) {
  return Object.fromEntries(level.parts
    .filter(part => Object.hasOwn(game.placed, part.id))
    .map(part => [part.id, componentStateModels[part.id]?.({ game, level, report }) ||
      { state: game.placed[part.id] ? 'normal' : 'unplaced' }]));
}
