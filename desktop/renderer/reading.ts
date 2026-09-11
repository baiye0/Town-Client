// Presentation of existing conversation content; no service state is changed.
export function mountReading() {
  const input = document.getElementById('reading-size') as HTMLInputElement;
  const value = document.getElementById('reading-size-value')!;
  const frame = document.getElementById('chat-frame') as HTMLIFrameElement;
  let size = 15;
  try { const saved = Number(localStorage.getItem('beings:reading-size')); if (Number.isInteger(saved) && saved >= 13 && saved <= 21) size = saved; } catch { /* Default. */ }
  const apply = () => {
    document.documentElement.style.setProperty('--reading-size', size + 'px');
    input.value = String(size); value.textContent = size + ' px';
    if (frame.getAttribute('src')) frame.contentWindow?.postMessage({ type: 'beings:reading', size }, 'beings://chat');
  };
  input.oninput = () => { size = Number(input.value); apply(); };
  input.onchange = () => { try { localStorage.setItem('beings:reading-size', String(size)); } catch { /* Setting remains active this run. */ } };
  document.getElementById('reading-reset')!.onclick = () => { size = 15; apply(); try { localStorage.removeItem('beings:reading-size'); } catch { /* Optional preference. */ } };
  frame.addEventListener('load', apply); apply();
}
