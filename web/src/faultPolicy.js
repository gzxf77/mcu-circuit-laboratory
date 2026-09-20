// Which fault verdicts are allowed to open the result dialog by themselves.
//
// A resistor that is over its own rated power is a *stress state*, not a broken
// circuit: on the power-budget level the player is expected to meet it while
// building (a ¼ W part carrying 30 mA), check the numbers in the part menu and
// then fix it. Popping a modal there interrupts the build and performs the
// 检查电路 for the player, so it never auto-opens: the part turns red, the status
// line reports 实际 / 额定, and the full explanation waits for the button.
//
// A short or an overcurrent stops the circuit from working at all, so those still
// surface immediately.
export const autoInspectKinds = Object.freeze(['overcurrent', 'gpio-short', 'supply-short', 'current-source-short']);

export const shouldAutoInspect = kind => autoInspectKinds.includes(kind);
