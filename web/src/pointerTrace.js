const storageKey = 'circuit-pointer-trace-v1';
const enabled = import.meta.env.DEV || new URLSearchParams(window.location.search).get('pointerTrace') === '1';
const limit = 200;

function readEntries() {
  try {
    const stored = JSON.parse(window.localStorage.getItem(storageKey) || '[]');
    return Array.isArray(stored) ? stored.filter(item => typeof item === 'string').slice(-limit) : [];
  } catch { return []; }
}

const entries = readEntries();
document.getElementById('circuit-pointer-trace')?.remove();

export function pointerTrace(phase, detail = {}) {
  if (!enabled) return;
  const line = new Date().toISOString() + ' ' + phase + ' ' + JSON.stringify(detail);
  entries.push(line);
  if (entries.length > limit) entries.splice(0, entries.length - limit);
  try { window.localStorage.setItem(storageKey, JSON.stringify(entries)); } catch { /* Logging must not block interaction. */ }
}

if (enabled) {
  const activePointers = new Set();
  const describe = event => ({
    pointerId: event.pointerId,
    pointerType: event.pointerType,
    target: event.target.tagName,
    className: event.target.getAttribute('class'),
    component: event.target.closest('.board-component,.board-mcu,.board-power,.board-ground,.board-probe')?.getAttribute('aria-label') || null,
    x: event.clientX,
    y: event.clientY,
  });
  const onDown = event => {
    if (!event.target.closest('.board-stage,.part-grid,.inventory-popover')) return;
    activePointers.add(event.pointerId);
    pointerTrace('dom-pointer-down', describe(event));
  };
  const onEnd = event => {
    if (!activePointers.delete(event.pointerId)) return;
    pointerTrace(event.type === 'pointercancel' ? 'dom-pointer-cancel' : 'dom-pointer-up', describe(event));
  };
  document.addEventListener('pointerdown', onDown, true);
  document.addEventListener('pointerup', onEnd, true);
  document.addEventListener('pointercancel', onEnd, true);
  if (import.meta.hot) import.meta.hot.dispose(() => {
    document.removeEventListener('pointerdown', onDown, true);
    document.removeEventListener('pointerup', onEnd, true);
    document.removeEventListener('pointercancel', onEnd, true);
  });
  pointerTrace('page-ready', { url: window.location.pathname + window.location.search, traceVersion: 4 });
}
