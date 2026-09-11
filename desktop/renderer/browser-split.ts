const storageKey = 'beings:browser-width';
const defaultRatio = 0.49;

export function mountBrowserSplit(panel: HTMLElement, changed: (dragging: boolean) => void) {
  const divider = document.getElementById('browser-divider')!;
  const stage = document.querySelector<HTMLElement>('.workspace-stage')!;
  let ratio = defaultRatio;
  try {
    const saved = Number(localStorage.getItem(storageKey));
    if (saved > 0 && saved < 1) ratio = saved;
  } catch { /* Width can still be adjusted when local storage is unavailable. */ }
  let pointer: number | undefined;
  let offset = 0;
  const limits = () => {
    const total = stage.getBoundingClientRect().width + panel.getBoundingClientRect().width;
    const min = Math.min(360, total / 2);
    return { total, min, max: Math.max(min, total - 300) };
  };
  const apply = (width?: number) => {
    if (panel.hidden) return;
    const { total, min, max } = limits();
    if (!total) return;
    const next = Math.max(min, Math.min(max, width ?? total * ratio));
    if (width !== undefined) ratio = next / total;
    panel.style.flexBasis = `${next}px`;
    const percent = Math.round(next / total * 100);
    divider.setAttribute('aria-valuenow', String(percent));
    divider.setAttribute('aria-valuemin', String(Math.round(min / total * 100)));
    divider.setAttribute('aria-valuemax', String(Math.round(max / total * 100)));
    divider.setAttribute('aria-valuetext', `浏览器占 ${percent}%`);
  };
  const save = () => { try { localStorage.setItem(storageKey, String(ratio)); } catch { /* Optional preference. */ } };
  const finish = () => {
    if (pointer === undefined) return;
    const id = pointer; pointer = undefined;
    document.body.classList.remove('browser-resizing');
    if (divider.hasPointerCapture(id)) divider.releasePointerCapture(id);
    changed(false); save();
  };
  divider.addEventListener('pointerdown', event => {
    if (event.button !== 0 || pointer !== undefined) return;
    event.preventDefault(); divider.focus();
    offset = panel.getBoundingClientRect().left - event.clientX;
    pointer = event.pointerId;
    divider.setPointerCapture(pointer);
    document.body.classList.add('browser-resizing');
    // A native WebContentsView otherwise takes mouse events away from the shell.
    changed(true);
  });
  divider.addEventListener('pointermove', event => {
    if (event.pointerId === pointer) apply(panel.getBoundingClientRect().right - event.clientX - offset);
  });
  divider.addEventListener('pointerup', finish);
  divider.addEventListener('pointercancel', finish);
  divider.addEventListener('lostpointercapture', finish);
  window.addEventListener('blur', finish);
  divider.addEventListener('dblclick', () => { ratio = defaultRatio; apply(); save(); });
  divider.addEventListener('keydown', event => {
    const width = panel.getBoundingClientRect().width;
    const { min, max } = limits();
    const step = event.shiftKey ? 60 : 20;
    const next = event.key === 'ArrowLeft' ? width + step : event.key === 'ArrowRight' ? width - step : event.key === 'Home' ? min : event.key === 'End' ? max : undefined;
    if (next === undefined) return;
    event.preventDefault(); apply(next); save();
  });
  const observer = new ResizeObserver(() => apply());
  observer.observe(panel.parentElement!);
  observer.observe(stage);
  return (open: boolean) => {
    divider.hidden = !open;
    if (!open) finish();
    else apply();
  };
}
