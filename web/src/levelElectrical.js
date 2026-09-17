// The calculation is reusable; every level supplies its own electrical values.
import { defaultLevel } from './levels/catalog.js';

export const levelElectrical = defaultLevel.electrical;

export function electricalFor(game, level = defaultLevel) {
  return { ...level.electrical, resistorOhms: game.resistorOhms ?? level.electrical.resistorOhms };
}

export function estimateSeriesCurrentMa({ gpioHighV, ledForwardV, resistorOhms }) {
  if (!Number.isFinite(gpioHighV) || !Number.isFinite(ledForwardV) ||
      !Number.isFinite(resistorOhms) || resistorOhms <= 0) return null;
  return Math.max(0, gpioHighV - ledForwardV) / resistorOhms * 1000;
}

export const resistorDropV = levelElectrical.gpioHighV - levelElectrical.ledForwardV;
export const expectedCurrentMa = estimateSeriesCurrentMa(levelElectrical);
