export function mountChatSearch(frame: HTMLIFrameElement, openChat: () => void) {
  const toggle = document.getElementById('toggle-chat-search')!;
  const panel = document.getElementById('chat-search-panel') as HTMLDialogElement;
  const input = document.getElementById('chat-search-input') as HTMLInputElement;
  const results = document.getElementById('chat-search-results')!;
  const status = document.getElementById('chat-search-status')!;
  let entries: { id: string; text: string }[] = [];
  function setOpen(open: boolean) {
    toggle.setAttribute('aria-expanded', String(open));
    if (open && !panel.open) panel.showModal();
    if (!open && panel.open) panel.close();
    if (open) { input.focus(); if (frame.getAttribute('src')) frame.contentWindow?.postMessage({ type: 'beings:search-request' }, 'beings://chat'); }
    else document.getElementById('options-trigger')?.focus();
  }
  function render() {
    const query = input.value.trim().toLocaleLowerCase();
    const matches = query ? entries.filter(entry => entry.text.toLocaleLowerCase().includes(query)) : [];
    const fragment = document.createDocumentFragment();
    for (const entry of matches) {
      const row = document.createElement('div'); row.setAttribute('role', 'listitem');
      const button = document.createElement('button'); button.className = 'chat-search-result';
      button.textContent = entry.text; button.title = entry.text;
      button.addEventListener('click', () => {
        setOpen(false); openChat(); frame.contentWindow?.postMessage({ type: 'beings:search-jump', id: entry.id }, 'beings://chat');
      });
      row.append(button); fragment.append(row);
    }
    results.replaceChildren(fragment);
    status.textContent = !query ? '输入关键词查找已加载的提问' : matches.length ? `${matches.length} 条匹配的提问` : '没有匹配的提问';
  }
  toggle.addEventListener('click', () => setOpen(toggle.getAttribute('aria-expanded') !== 'true'));
  panel.addEventListener('close', () => toggle.setAttribute('aria-expanded', 'false'));
  document.getElementById('close-chat-search')!.addEventListener('click', () => setOpen(false));
  input.addEventListener('input', render);
  panel.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); setOpen(false); }
    if (event.target === input && event.key === 'Enter') { event.preventDefault(); results.querySelector<HTMLButtonElement>('button')?.click(); }
    if (event.key === 'ArrowDown') { event.preventDefault(); const buttons = Array.from(results.querySelectorAll<HTMLButtonElement>('button')); buttons[Math.min(buttons.indexOf(document.activeElement as HTMLButtonElement) + 1, buttons.length - 1)]?.focus(); }
    if (event.key === 'ArrowUp') { event.preventDefault(); const buttons = Array.from(results.querySelectorAll<HTMLButtonElement>('button')); const index = buttons.indexOf(document.activeElement as HTMLButtonElement); if (index <= 0) input.focus(); else buttons[index - 1].focus(); }
  });
  frame.addEventListener('load', () => { entries = []; input.value = ''; render(); if (frame.getAttribute('src')) frame.contentWindow?.postMessage({ type: 'beings:search-request' }, 'beings://chat'); });
  window.addEventListener('message', event => {
    if (event.origin !== 'beings://chat' || event.source !== frame.contentWindow || event.data?.type !== 'beings:search-index') return;
    if (event.data.revision !== new URL(frame.src).searchParams.get('revision')) return;
    const next = event.data.entries;
    if (!Array.isArray(next) || next.length > 2000 || !next.every(entry => entry && typeof entry.id === 'string' && /^turn-\d+$/.test(entry.id) && typeof entry.text === 'string' && entry.text.length <= 240)) return;
    entries = next; render();
  });
  return { open: () => setOpen(true) };
}
