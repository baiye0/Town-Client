// Reuse Loom's scroll controller so incoming output respects deliberate navigation.
declare let scrollLock: boolean;
declare let scrollRaf: number | null;

(() => {
  const messages = document.getElementById('messages')!;
  const nav = document.createElement('nav');
  nav.id = 'chat-index'; nav.setAttribute('aria-label', '对话快速索引'); nav.hidden = true;
  const ticks = document.createElement('div'); ticks.id = 'chat-index-ticks';
  const latest = document.createElement('button'); latest.id = 'chat-index-latest'; latest.textContent = '↓';
  latest.title = '回到最新消息'; latest.setAttribute('aria-label', '回到最新消息');
  const preview = document.createElement('div'); preview.id = 'chat-index-preview'; preview.hidden = true;
  preview.setAttribute('role', 'tooltip');
  const question = document.createElement('strong');
  const answer = document.createElement('p'); preview.append(question, answer);
  nav.append(ticks, latest); document.body.append(nav, preview);
  type Turn = { element: HTMLElement; button: HTMLButtonElement; id: string; text: string };
  let turns: Turn[] = [];
  let counter = 0;
  let active = -1;
  let hovered: Turn | undefined;
  let highlightTimer: ReturnType<typeof setTimeout>;
  const revision = new URLSearchParams(location.search).get('revision');
  function publish() {
    parent.postMessage({ type: 'beings:search-index', revision, entries: turns.slice(-2000).map(({ id, text }) => ({ id, text })) }, '*');
  }
  function hidePreview() { preview.hidden = true; hovered = undefined; }
  function showPreview(turn: Turn) {
    hovered = turn; question.textContent = turn.text;
    const replies: string[] = [];
    let next = turn.element.nextElementSibling;
    while (next && !next.matches('.message.user')) {
      if (next.matches('.message.being:not(.thinking-indicator)')) replies.push(next.querySelector('.content')?.textContent || '');
      if (replies.join('').length >= 240) break;
      next = next.nextElementSibling;
    }
    answer.textContent = replies.join(' ').replace(/\s+/g, ' ').trim().slice(0, 240) || '暂无回复';
    preview.hidden = false;
    const rect = turn.button.getBoundingClientRect();
    preview.style.top = `${Math.max(12, Math.min(rect.top - 20, innerHeight - preview.offsetHeight - 12))}px`;
  }
  function jump(turn?: Turn) {
    if (scrollRaf !== null) { cancelAnimationFrame(scrollRaf); scrollRaf = null; }
    scrollLock = !turn;
    messages.scrollTo({ top: turn ? messages.scrollTop + turn.element.getBoundingClientRect().top - messages.getBoundingClientRect().top - 24 : messages.scrollHeight, behavior: 'instant' });
    messages.querySelector('.index-target')?.classList.remove('index-target');
    clearTimeout(highlightTimer);
    if (turn) { turn.element.classList.add('index-target'); highlightTimer = setTimeout(() => turn.element.classList.remove('index-target'), 1400); }
    hidePreview(); updateActive();
  }
  latest.addEventListener('click', () => jump());
  function updateActive() {
    const top = messages.getBoundingClientRect().top + 44;
    let index = turns.length ? 0 : -1;
    for (let i = 0; i < turns.length; i++) {
      if (turns[i].element.getBoundingClientRect().top > top) break;
      index = i;
    }
    if (messages.scrollHeight - messages.scrollTop - messages.clientHeight < 8) index = turns.length - 1;
    if (active !== index) {
      active = index;
      turns.forEach((turn, i) => {
        const distance = Math.abs(i - active);
        turn.button.style.setProperty('--tick-width', `${distance === 0 ? 26 : distance === 1 ? 20 : distance === 2 ? 15 : distance === 3 ? 10 : 6}px`);
        if (i === active) turn.button.setAttribute('aria-current', 'location'); else turn.button.removeAttribute('aria-current');
      });
      const button = turns[active]?.button;
      if (button && !nav.matches(':hover, :focus-within')) ticks.scrollTop = button.offsetTop - ticks.clientHeight / 2 + button.offsetHeight / 2;
    }
  }
  function refresh() {
    const elements = Array.from(messages.querySelectorAll<HTMLElement>(':scope > .message.user'));
    if (elements.length === turns.length && elements.every((element, i) => turns[i].element === element)) return;
    hidePreview();
    const previous = new Map(turns.map(turn => [turn.element, turn]));
    turns = elements.map((element, index) => {
      const existing = previous.get(element); if (existing) return existing;
      const button = document.createElement('button'); button.className = 'chat-index-tick';
      const text = (element.querySelector('.content')?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 240) || '附件消息';
      button.setAttribute('aria-label', `跳转到提问 ${index + 1}：${text}`);
      button.setAttribute('aria-describedby', 'chat-index-preview');
      const line = document.createElement('span'); line.setAttribute('aria-hidden', 'true'); button.append(line);
      const turn = { element, button, text, id: `turn-${++counter}` };
      button.addEventListener('mouseenter', () => showPreview(turn));
      button.addEventListener('focus', () => showPreview(turn));
      button.addEventListener('mouseleave', hidePreview);
      button.addEventListener('blur', hidePreview);
      button.addEventListener('click', () => jump(turn));
      return turn;
    });
    ticks.replaceChildren(...turns.map(turn => turn.button));
    nav.hidden = !turns.length; active = -1; updateActive(); publish();
  }
  ticks.addEventListener('keydown', event => {
    const index = turns.findIndex(turn => turn.button === document.activeElement);
    const target = event.key === 'ArrowDown' ? Math.min(index + 1, turns.length - 1) : event.key === 'ArrowUp' ? Math.max(index - 1, 0) : event.key === 'Home' ? 0 : event.key === 'End' ? turns.length - 1 : -1;
    if (target >= 0) { event.preventDefault(); turns[target].button.focus(); }
    if (event.key === 'Escape') hidePreview();
  });
  ticks.addEventListener('scroll', hidePreview, { passive: true });
  let scheduled = false;
  new MutationObserver(() => {
    if (scheduled) return; scheduled = true;
    requestAnimationFrame(() => { scheduled = false; refresh(); });
  }).observe(messages, { childList: true });
  let scrollScheduled = false;
  messages.addEventListener('scroll', () => {
    if (scrollScheduled) return; scrollScheduled = true;
    requestAnimationFrame(() => { scrollScheduled = false; updateActive(); });
  }, { passive: true });
  new ResizeObserver(() => { updateActive(); if (hovered) showPreview(hovered); }).observe(messages);
  window.addEventListener('message', event => {
    if (event.source !== parent) return;
    if (event.data?.type === 'beings:search-request') publish();
    if (event.data?.type === 'beings:search-jump') {
      const turn = turns.find(turn => turn.id === event.data.id);
      if (turn) jump(turn);
    }
  });
  refresh();
})();
