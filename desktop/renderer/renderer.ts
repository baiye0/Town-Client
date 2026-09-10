import './style.css';
import './town.css';
import { TownViews } from './town';
import { Workspace } from './workspace';
import './quiet.css';
import { mountChatSearch } from './chat-search';
import { validPlaceTarget } from './place-target';
import type { PortalState, Snapshot } from '../shared';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const api = window.beings;
const updateLabel = (state: import('../updates').UpdateState) => {
  $('check-updates').textContent = state.phase === 'available' ? `更新至 ${state.latestVersion}` : state.phase === 'checking' ? '正在检查更新…' : '检查更新';
};
$('check-updates').addEventListener('click', () => action(() => api.checkUpdates()));
api.onUpdate(updateLabel);
void api.updateState().then(updateLabel);

let snapshot: Snapshot;
let saving = false;
let theme: 'light' | 'dark' = 'light';
let chatLoading = false;
function updateChatRefresh() {
  const button = $<HTMLButtonElement>('refresh-chat');
  button.disabled = !snapshot?.settings.hasToken || chatLoading;
  button.setAttribute('aria-busy', String(chatLoading));
}
function connectionStatus(state: string) {
  const labels: Record<string, string> = { online: '已连接', connecting: '正在连接', reconnecting: '正在重连', degraded: '网络不稳定', offline: '已离线' };
  const label = labels[state] || '尚未连接';
  $('cloud-status').textContent = label;
  $('connection-light').dataset.state = state;
  $('connection-light').title = label;
  $('connection-light').setAttribute('aria-label', label);
}
function applyTheme(next: 'light' | 'dark') {
  theme = next; document.documentElement.dataset.theme = next;
  $('theme-toggle').setAttribute('title', next === 'light' ? '切换到深色' : '切换到浅色');
  $<HTMLIFrameElement>('chat-frame').contentWindow?.postMessage({ type: 'beings:appearance', theme: next }, 'beings://chat');
}
$('theme-toggle').addEventListener('click', () => action(async () => applyTheme(await api.appearance(theme === 'light' ? 'dark' : 'light'))));
$<HTMLIFrameElement>('chat-frame').addEventListener('load', () => {
  chatLoading = false;
  updateChatRefresh();
  applyTheme(theme);
});
$('refresh-chat').addEventListener('click', () => {
  if (snapshot?.settings.hasToken && !chatLoading) applySnapshot(snapshot, true);
});
let toastTimer: ReturnType<typeof setTimeout>;
const labels = { running: '运行中', stopped: '未启动', starting: '启动中', connected: '已连接', reconnecting: '重连中', stopping: '停止中', external: '独立服务运行中', error: '启动失败' };
function toast(error: unknown) {
  $('toast').textContent = String(error instanceof Error ? error.message : error).replace(/^Error invoking remote method '[^']+': Error: /, '');
  $('toast').hidden = false; clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 6000);
}
async function action(operation: () => Promise<unknown>) { try { await operation(); } catch (error) { toast(error); } }
const workspace = new Workspace($<HTMLIFrameElement>('chat-frame'), view => setView(view), toast);
const townViews = new TownViews(api, toast, view => setView(view), workspace.scenes, () => { setView('chat'); workspace.toggle(true); });
function setView(view: string, resourceId?: string) {
  document.body.dataset.view = view;
  workspace.enter(view);
  $('portal-view').hidden = view !== 'portal';
  workspace.toggle(false);
  const sheet = $<HTMLDialogElement>('place-sheet');
  if (view === 'chat') { if (sheet.open) sheet.close(); }
  else if (!sheet.open) sheet.showModal();
  const titles: Record<string, string> = { chat: '对话', portal: '本机 Portal', town: '小镇广场', bonfire: '篝火', firesides: '围炉', mail: '私信', embers: '书架', scrolls: '卷轴', kits: 'Kit 工具库' };
  $('view-title').textContent = titles[view] || '对话';
  $('town-view').hidden = ['chat', 'portal'].includes(view);
  townViews.show(view, resourceId);
  document.querySelectorAll<HTMLElement>('[data-view]').forEach(button => {
    const active = button.dataset.view === view;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  });
}
const chatSearch = mountChatSearch($<HTMLIFrameElement>('chat-frame'), () => setView('chat'));
const options = $<HTMLDetailsElement>('conversation-options');
options.addEventListener('click', event => { if ((event.target as Element).closest('button')) options.open = false; });
document.addEventListener('pointerdown', event => { if (!options.contains(event.target as Node)) options.open = false; });
options.addEventListener('keydown', event => { if (event.key === 'Escape') { options.open = false; $('options-trigger').focus(); } });
$('back-to-chat').addEventListener('click', () => setView('chat'));
$('place-sheet').addEventListener('cancel', event => { event.preventDefault(); setView('chat'); });
$('place-sheet').addEventListener('click', event => {
  const sheet = $('place-sheet'), bounds = sheet.getBoundingClientRect();
  if (event.target === sheet && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom)) setView('chat');
});
document.querySelectorAll<HTMLElement>('[data-chat-action]').forEach(button => button.addEventListener('click', () => {
  setView('chat');
  $<HTMLIFrameElement>('chat-frame').contentWindow?.postMessage({ type: 'beings:chat-action', action: button.dataset.chatAction }, 'beings://chat');
}));
function renderPortal(state: PortalState) {
  if (snapshot) snapshot.portal = state;
  $('portal-phase').textContent = labels[state.phase];
  $('portal-message').textContent = state.message;
  $('portal-pid').textContent = state.pid ? `PID ${state.pid}${state.managed === false ? ' · 外部管理' : ''}` : '—';
  $('portal-pid').title = state.runtimePath || '';
  const stopped = ['stopped', 'error', 'external'].includes(state.phase);
  $<HTMLButtonElement>('start-portal').disabled = !snapshot?.settings.hasToken || !stopped || state.managed === false;
  $<HTMLButtonElement>('stop-portal').disabled = stopped || state.phase === 'stopping' || state.managed === false;
  const log = $('portal-logs');
  const wasAtBottom = log.scrollTop + log.clientHeight >= log.scrollHeight - 32;
  log.textContent = state.logs.join('\n') || '启动 Portal 后，连接与工具运行状态会显示在这里。';
  if (wasAtBottom) log.scrollTop = log.scrollHeight;
}
function applySnapshot(next: Snapshot, reload = false) {
  snapshot = next;
  workspace.snapshot(next);
  const settings = next.settings;
  $('startup-notice').textContent = next.notice || '';
  $('startup-notice').hidden = !next.notice;
  document.querySelectorAll<HTMLButtonElement>('[data-chat-action], #toggle-chat-search').forEach(button => { button.disabled = !settings.hasToken; });
  $('background-status').textContent = next.portal.managed === false ? `当前运行目录：${next.portal.runtimePath}。客户端仅观察；自启与守护状态以原管理方式为准。` : next.background?.enabled ? `${next.background.message}。点击“停止”会同时停用登录自启。` : next.background?.message || '后台服务未启用；临时启动的 Portal 随客户端退出。';
  $('conversation-name').textContent = settings.being || 'Being';
  $('workspace-label').textContent = settings.workspace;
  $('portal-name').textContent = settings.portalName;
  $('exec-label').textContent = settings.allowExec ? '已允许本机命令' : '未启用';
  $('kits-label').textContent = settings.kitsEnabled ? 'Kits 与自定义工具已启用' : '未启用';
  renderPortal(next.portal);
  const frame = $<HTMLIFrameElement>('chat-frame');
  $('welcome').hidden = settings.hasToken;
  frame.hidden = !settings.hasToken;
  if (settings.hasToken && (!frame.getAttribute('src') || reload)) {
    chatLoading = true;
    connectionStatus('connecting');
    frame.src = `beings://chat/?name=${encodeURIComponent(settings.being)}&theme=${theme}&revision=${Date.now()}`;
  }
  updateChatRefresh();
}
function showSettings() {
  if (!snapshot) return;
  const settings = snapshot.settings;
  $<HTMLInputElement>('connection-link').value = '';
  $<HTMLInputElement>('connection-link').required = !settings.hasToken;
  $<HTMLInputElement>('connection-link').placeholder = settings.hasToken ? `${settings.endpoint}/ · 已安全保存，留空保留` : 'https://echo.beings.town/your_being/?token=…';
  $<HTMLInputElement>('portal-name-input').value = settings.portalName;
  $<HTMLInputElement>('workspace-input').value = settings.workspace;
  $<HTMLInputElement>('binary-input').value = settings.portalBinary;
  $<HTMLInputElement>('autostart-input').checked = settings.autoStart;
  $<HTMLInputElement>('background-input').checked = Boolean(settings.backgroundEnabled);
  $<HTMLInputElement>('background-input').disabled = snapshot.background?.supported === false;
  $<HTMLInputElement>('autostart-input').disabled = Boolean(settings.backgroundEnabled);
  $<HTMLInputElement>('exec-input').checked = settings.allowExec;
  $<HTMLInputElement>('kits-input').checked = settings.kitsEnabled;
  const imported = Boolean(settings.portalConfigPath);
  $('existing-config-note').hidden = !imported;
  $('existing-config-note').textContent = imported ? `沿用现有配置：${settings.portalConfigPath}。工作目录、命令、截图及扩展工具以该文件为准；在原配置中修改后重启 Portal 生效。` : '';
  $<HTMLInputElement>('workspace-input').readOnly = imported;
  (document.querySelector('[data-pick="workspace"]') as HTMLButtonElement).disabled = imported;
  $<HTMLInputElement>('exec-input').disabled = imported;
  $<HTMLInputElement>('kits-input').disabled = imported;
  $('settings-error').textContent = '';
  $<HTMLDialogElement>('settings-dialog').showModal();
}
for (const id of ['settings-button', 'connect-button', 'portal-settings']) $(id).addEventListener('click', showSettings);
$('close-settings').addEventListener('click', () => $<HTMLDialogElement>('settings-dialog').close());
document.querySelectorAll<HTMLElement>('[data-view]').forEach(button => button.addEventListener('click', () => setView(button.dataset.view!)));
$('open-workspace').addEventListener('click', () => action(() => api.openWorkspace()));
$('start-portal').addEventListener('click', () => action(async () => { renderPortal(await api.startPortal()); }));
$('stop-portal').addEventListener('click', () => action(async () => { renderPortal(await api.stopPortal()); applySnapshot(await api.snapshot()); }));
$('background-input').addEventListener('change', () => { $<HTMLInputElement>('autostart-input').disabled = $<HTMLInputElement>('background-input').checked; });
document.querySelectorAll<HTMLElement>('[data-pick]').forEach(button => button.addEventListener('click', () => action(async () => {
  const kind = button.dataset.pick as 'workspace' | 'binary';
  const selected = await api.choose(kind);
  if (selected) $<HTMLInputElement>(kind === 'workspace' ? 'workspace-input' : 'binary-input').value = selected;
})));
$('settings-form').addEventListener('submit', async event => {
  event.preventDefault(); if (saving) return;
  saving = true; $<HTMLButtonElement>('save-settings').disabled = true;
  $('settings-error').textContent = '';
  try {
    const next = await api.save({
      connectionLink: $<HTMLInputElement>('connection-link').value,
      workspace: $<HTMLInputElement>('workspace-input').value,
      portalBinary: $<HTMLInputElement>('binary-input').value,
      portalName: $<HTMLInputElement>('portal-name-input').value,
      autoStart: $<HTMLInputElement>('autostart-input').checked,
      backgroundEnabled: $<HTMLInputElement>('background-input').checked,
      allowExec: $<HTMLInputElement>('exec-input').checked,
      kitsEnabled: $<HTMLInputElement>('kits-input').checked,
      portalConfigPath: snapshot.settings.portalConfigPath,
      portalEnvironmentPath: snapshot.settings.portalEnvironmentPath,
    });
    $<HTMLInputElement>('connection-link').value = '';
    applySnapshot(next, true); $<HTMLDialogElement>('settings-dialog').close(); setView('chat');
    if (next.settings.autoStart) await action(async () => { renderPortal(await api.startPortal()); });
  } catch (error) {
    $('settings-error').textContent = String(error).replace(/^Error: Error invoking remote method '[^']+': Error: /, '');
  } finally { saving = false; $<HTMLButtonElement>('save-settings').disabled = false; }
});
window.addEventListener('message', event => {
  const frame = $<HTMLIFrameElement>('chat-frame');
  if (event.origin === 'beings://chat' && event.source === frame.contentWindow &&
      event.data?.type === 'beings:chat-search' && frame.getAttribute('src') &&
      event.data.revision === new URL(frame.src).searchParams.get('revision')) { chatSearch.open(); return; }
  if (event.origin === 'beings://chat' && event.source === frame.contentWindow &&
      event.data?.type === 'beings:open-place' && frame.getAttribute('src') &&
      event.data.revision === new URL(frame.src).searchParams.get('revision') &&
      validPlaceTarget(event.data)) {
    setView(event.data.view, event.data.id); return;
  }
  if (event.origin !== 'beings://chat' || event.source !== $<HTMLIFrameElement>('chat-frame').contentWindow || event.data?.type !== 'beings:connection') return;
  const states: Record<string, string> = { online: '云端已连接', connecting: '正在连接…', reconnecting: '正在重连…', degraded: '网络不稳定', offline: '云端离线' };
  const label = states[event.data.state]; if (!label) return;
  connectionStatus(event.data.state);
  workspace.connection(event.data.state === 'online');
});
document.addEventListener('keydown', event => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f' && !document.querySelector('dialog[open]')) { event.preventDefault(); chatSearch.open(); }
  if ((event.metaKey || event.ctrlKey) && event.key === '1') { event.preventDefault(); setView('chat'); }
  if ((event.metaKey || event.ctrlKey) && event.key === ',') { event.preventDefault(); showSettings(); }
});
if (navigator.userAgent.includes('Windows')) document.querySelector('#toggle-chat-search small')!.textContent = 'Ctrl F';
if (!api) toast('请通过 Beings 桌面客户端打开此页面。');
else {
  document.documentElement.dataset.platform = api.platform;
  api.onPortal(state => { renderPortal(state); void action(async () => applySnapshot(await api.snapshot())); });
  const initialize = async () => {
    $('startup-retry').hidden = true;
    $('startup-spinner').hidden = false;
    $('startup-screen').setAttribute('aria-busy', 'true');
    $('startup-message').textContent = '正在加载配置并恢复连接…';
    try {
      const [appearance, state] = await Promise.all([api.appearance(), api.snapshot()]);
      applyTheme(appearance); applySnapshot(state);
      document.body.dataset.view = 'chat';
      $('client-main').hidden = false;
      $('startup-screen').hidden = true;
    } catch {
      $('startup-message').textContent = '配置加载未完成，请重试。原配置不会被覆盖。';
      $('startup-spinner').hidden = true;
      $('startup-retry').hidden = false;
    } finally { $('startup-screen').setAttribute('aria-busy', 'false'); }
  };
  $('startup-retry').addEventListener('click', () => { void initialize(); });
  void initialize();
}
