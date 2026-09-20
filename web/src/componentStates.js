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
  if (level.model === 'resistor-dc-v1') {
    const placedResistorIds = Object.keys(game.placed).filter(id => game.placed[id] && /^r\d+$/.test(id));
    const ids = [...new Set([...(level.circuit.resistors || []), ...placedResistorIds, ...(level.board.fixedParts || [])])];
    const voltageAt = terminal => report.network?.voltageAt?.(terminal) ?? null;
    // Reference readings for the power judgement: `associated` says whether the
    // board's current arrow enters the terminal marked "+", which decides whether
    // P = U·I or P = −U·I. Sources are drawn with the arrow leaving "+" (the usual
    // textbook drawing), so they are non-associated.
    const reference = (id, voltageV, currentMa, associated) => ({ id, voltageV, currentMa, associated });
    return Object.fromEntries(ids
      .filter(id => Object.hasOwn(game.placed, id))
      .map(id => {
      if (id === 'isource') return [id, {
        state: report.network?.currentSourceShorted ? 'shorted' : report.network?.unresolved ? 'open' : 'conducting',
        currentMa: report.network?.sourceCurrentMa ?? 0,
        voltageV: report.network?.currentSourceVoltageV ?? null,
        reference: reference(id, report.network?.currentSourceVoltageV ?? null, report.network?.sourceCurrentMa ?? null, false),
        absorbedPowerMw: report.network?.elementPowerMw?.[id] ?? null,
      }];
      if (id === level.circuit.controlledSource?.id) {
        const currentMa = report.network?.controlledSourceCurrentMa;
        return [id, {
          state: Number.isFinite(currentMa) ? 'conducting' : 'open',
          currentMa: Number.isFinite(currentMa) ? currentMa : 0,
          controlV: report.network?.controlledSourceControlV ?? null,
          gmMs: report.network?.controlledTransconductanceMs ?? level.electrical.controlledTransconductanceMs,
        }];
      }
      if (id === level.circuit.source) return [id, {
        state: report.network?.shorted ? 'shorted' : 'conducting',
        currentMa: report.network?.voltageSourceCurrentMa ?? null,
        reference: reference(id, level.electrical.sourceV, report.network?.voltageSourceCurrentMa ?? null, false),
        absorbedPowerMw: report.network?.elementPowerMw?.[id] ?? null,
      }];
      const result = report.network?.resistorResults[id];
      if (!result) return [id, { state: game.placed[id] ? 'normal' : 'unplaced' }];
      const currentMa = result.currentMa || 0;
      const dropV = Number.isFinite(voltageAt(id + '.a')) && Number.isFinite(voltageAt(id + '.b'))
        ? voltageAt(id + '.a') - voltageAt(id + '.b') : null;
      const partRatedW = result.ratedPowerW ?? level.electrical.resistorRatedPowerW;
      return [id, {
        state: !game.placed[id] ? 'unplaced'
          : result.powerW > partRatedW ? 'overload'
            : currentMa > 0 ? 'conducting' : 'normal',
        currentMa, powerW: result.powerW || 0, direction: result.direction,
        ratedPowerW: partRatedW,
        reference: reference(id, dropV, result.signedCurrentMa ?? null, true),
        absorbedPowerMw: report.network?.elementPowerMw?.[id] ?? null,
      }];
    }));
  }
  return Object.fromEntries(level.parts
    .filter(part => Object.hasOwn(game.placed, part.id))
    .map(part => [part.id, componentStateModels[part.id]?.({ game, level, report }) ||
      { state: game.placed[part.id] ? 'normal' : 'unplaced' }]));
}
