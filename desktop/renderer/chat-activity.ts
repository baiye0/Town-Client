// Read the existing stream state; presentation never changes tool execution or recovery.
declare const actionLog: { type: string; name?: string; label?: string; arg?: string; preview?: string; text?: string; result?: string; done?: boolean; error?: boolean; duration?: number; ts?: number }[];
declare const isStreaming: boolean;
declare const streamStatus: string;
declare const userStoppedStream: boolean;
declare const pendingRecovery: unknown;
declare const livePhase: string;
declare const tuiCurrentState: string | null;
declare const tuiCurrentArg: string;
declare const tuiHintText: string;
declare function scrollToBottom(): void;
declare function stopCurrentTurn(): Promise<void>;

(() => {
  const messages = document.getElementById('messages')!;
  type Entry = typeof actionLog[number];
  type Run = { root: HTMLDetailsElement; label: HTMLElement; elapsed: HTMLElement; count: HTMLElement; list: HTMLElement; hint: HTMLElement; stop: HTMLButtonElement; entries: Entry[]; start: number; ended: boolean; signature: string };
  let current: Run | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let queued = false;
  let finished = false;
  const duration = (seconds: number) => seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
  const symbols: Record<string, string> = {
    check: '<path d="m3.5 8 3 3 6-6"/>',
    think: '<path d="M6 11h4M6.5 13h3M5.5 9.5a4.5 4.5 0 1 1 5 0L10 11H6Z"/>',
    tool: '<path d="m3.5 5 3 3-3 3M9 11h3.5"/>',
    error: '<circle cx="8" cy="8" r="5.5"/><path d="M8 4.5v4M8 11h.01"/>',
    stop: '<path d="M4 8h8"/>',
    chevron: '<path d="m6 4 4 4-4 4"/>',
  };
  const svg = (name: string) => `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${symbols[name]}</svg>`;
  function placeRunBelowReply() {
    // Loom appends each reply segment after the status created at the start of a turn.
    // Follow those segments while running, then leave the completed record with its turn.
    if (current && !current.ended && current.root.parentElement === messages && messages.lastElementChild !== current.root) {
      messages.append(current.root);
    }
  }
  new MutationObserver(placeRunBelowReply).observe(messages, { childList: true });
  function createRun() {
    const root = document.createElement('details'); root.className = 'run-activity running';
    const summary = document.createElement('summary');
    const icon = document.createElement('span'); icon.className = 'run-icon'; icon.setAttribute('aria-hidden', 'true'); icon.innerHTML = svg('check');
    const label = document.createElement('span'); label.className = 'run-label';
    const elapsed = document.createElement('span'); elapsed.className = 'run-elapsed';
    const count = document.createElement('span'); count.className = 'run-count';
    const chevron = document.createElement('span'); chevron.className = 'run-chevron'; chevron.innerHTML = svg('chevron'); chevron.setAttribute('aria-hidden', 'true');
    const caption = document.createElement('span'); caption.className = 'run-caption';
    caption.append(label, elapsed, count);
    summary.append(icon, caption, chevron);
    const list = document.createElement('div'); list.className = 'run-list';
    const hint = document.createElement('p'); hint.className = 'run-hint'; hint.hidden = true;
    const stop = document.createElement('button'); stop.className = 'run-stop'; stop.title = '停止生成'; stop.setAttribute('aria-label', '停止生成');
    stop.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); stop.disabled = true; void stopCurrentTurn().finally(() => { stop.disabled = false; }); });
    summary.append(stop);
    // Keep the original document-wide composer focus handler out of process details.
    root.addEventListener('click', event => event.stopPropagation());
    root.append(summary, hint, list);
    messages.append(root);
    current = { root, label, elapsed, count, list, hint, stop, entries: [], start: Date.now(), ended: false, signature: '' };
    clearInterval(timer); timer = setInterval(update, 1000);
    scrollToBottom();
  }
  function renderEntries(run: Run) {
    const signature = JSON.stringify(run.entries);
    if (signature === run.signature) return;
    run.signature = signature;
    const fragment = document.createDocumentFragment();
    for (const entry of run.entries) {
      const row = document.createElement('div'); row.className = 'run-entry';
      const heading = document.createElement('div'); heading.className = 'run-entry-heading';
      const icon = document.createElement('span'); icon.className = `run-entry-icon${entry.error ? ' error' : ''}`;
      icon.innerHTML = svg(entry.error ? 'error' : entry.type === 'think' ? 'think' : 'tool');
      icon.setAttribute('aria-hidden', 'true');
      const title = document.createElement('span'); title.className = 'run-entry-title';
      title.textContent = entry.type === 'think' ? `思考${entry.duration ? ` · ${duration(entry.duration)}` : ''}` : entry.name || entry.label || '工具';
      const state = document.createElement('small'); state.textContent = entry.error ? '失败' : entry.done ? '已完成' : run.ended ? '未完成' : '进行中';
      const caption = document.createElement('div'); caption.className = 'run-entry-caption'; caption.append(title, state);
      heading.append(icon, caption); row.append(heading);
      const detail = document.createElement('p');
      detail.textContent = entry.type === 'think' ? (entry.text || entry.preview || '等待服务端返回思考内容…').slice(0, 20000) : [entry.arg, entry.result].filter(Boolean).join('\n');
      if (detail.textContent) row.append(detail);
      fragment.append(row);
    }
    if (!run.entries.length) { const empty = document.createElement('p'); empty.className = 'run-empty'; empty.textContent = run.ended ? '本轮未返回额外的过程记录。' : '正在等待响应…'; fragment.append(empty); }
    run.list.replaceChildren(fragment);
  }
  function update() {
    if (current && !current.root.isConnected) { current = undefined; clearInterval(timer); }
    if (!current || current.ended) {
      if (!isStreaming || finished) { finished = false; return; }
      createRun();
    }
    const run = current!;
    placeRunBelowReply();
    // Copy while live. The original log is cleared on a timer after completion.
    if (actionLog.length || !run.entries.length || isStreaming) run.entries = actionLog.map(entry => ({ ...entry }));
    const waiting = !isStreaming && Boolean(pendingRecovery);
    const ended = finished || (!isStreaming && !waiting);
    run.elapsed.textContent = duration(Math.max(0, Math.floor((Date.now() - run.start) / 1000)));
    const tools = run.entries.filter(entry => entry.type === 'tool');
    run.count.textContent = tools.length ? `· ${tools.length} 次工具调用` : '';
    const lastTool = [...tools].reverse().find(entry => !entry.done);
    run.hint.textContent = tuiHintText || '';
    run.hint.hidden = !run.hint.textContent;
    if (ended) {
      run.ended = true; run.root.classList.remove('running');
      run.stop.hidden = true;
      run.label.textContent = userStoppedStream ? '已停止' : streamStatus === 'error' ? '运行中断' : finished ? '已处理' : '已结束';
      run.root.dataset.outcome = userStoppedStream ? 'stopped' : streamStatus === 'error' ? 'error' : 'done';
      run.root.querySelector('.run-icon')!.innerHTML = svg(userStoppedStream ? 'stop' : streamStatus === 'error' ? 'error' : 'check');
      if (tools.some(entry => entry.error)) run.count.textContent += ' · 含失败项';
      run.root.open = false; run.hint.hidden = true;
      clearInterval(timer);
      // Refresh status labels even if the entry payload has not changed.
      run.signature = '';
    } else {
      run.label.textContent = waiting ? '正在恢复连接' : livePhase === 'tool' && lastTool ? `正在运行 ${lastTool.name || '工具'}` : livePhase === 'text' ? '正在回复' : tuiCurrentState && tuiCurrentState !== '在思考' ? tuiCurrentState : '思考中';
      run.label.title = tuiCurrentArg || '';
    }
    renderEntries(run); finished = false;
  }
  window.addEventListener('beings:activity', event => {
    if ((event as CustomEvent).detail === 'done') finished = true;
    if (queued) return; queued = true;
    queueMicrotask(() => { queued = false; update(); });
  });
})();
