import { app, BrowserWindow, dialog, ipcMain, net, nativeTheme, protocol, safeStorage, session, shell, Menu } from 'electron';
import path from 'node:path';
import os from 'node:os';
import { access, mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { SettingsStore } from './settings';
import { PortalSupervisor } from './portal';
import { ExternalPortalObserver } from './external-portal';
import { RuntimeUpdater, loadRuntimeBundle, type RuntimeUpdateResult } from './runtime-update';
import { UpdateChecker } from './updates';
import { installerEvent, handleInstallerEvent } from './installer-events';
import { BackgroundPortal } from './background';
import { KitInstaller } from './kit-install';
import { ChatProxy } from './proxy';
import type { SaveSettings, TownPost, TownQuery, KitInstallInput } from './shared';
import { TownLive } from './town-live';
import { TownClient, TownCredentials, TOWN_ORIGIN } from './town';
import { localKits, kitLocation, readKit, importLocalKit } from './kits';

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;
declare const TOWN_UPDATE_REPOSITORY: string;

protocol.registerSchemesAsPrivileged([{ scheme: 'beings', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
if (process.env.BEINGS_USER_DATA) app.setPath('userData', path.resolve(process.env.BEINGS_USER_DATA));
app.setName('Beings');
let window: BrowserWindow | null = null;
let portal: PortalSupervisor;
let proxy: ChatProxy;
let store: SettingsStore;
let background: BackgroundPortal;
let kitInstaller: KitInstaller;
let townLive: TownLive;
let updatePoll: ReturnType<typeof setInterval> | undefined;
let backgroundPoll: ReturnType<typeof setInterval> | undefined;
let quitting = false;
let mutation = Promise.resolve();
const exclusive = <T>(operation: () => Promise<T>): Promise<T> => {
  const next = mutation.then(operation);
  mutation = next.then(() => {}, () => {});
  return next;
};
const shellURL = () => new URL(MAIN_WINDOW_VITE_DEV_SERVER_URL || 'beings://desktop/').href;
const mime: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
const chatCSP = "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src https: data: blob:; connect-src 'self'; font-src 'self'; base-uri 'none'; form-action 'none'; frame-src 'none'";

async function openExternal(url: string) {
  try {
    const parsed = new URL(url);
    if (['https:', 'http:'].includes(parsed.protocol) && !parsed.username && !parsed.password) await shell.openExternal(url);
  } catch { /* Unsupported links stay inside the sandbox. */ }
}
function createWindow() {
  const acrylic = process.platform === 'win32' && Number(os.release().split('.')[2]) >= 22621;
  window = new BrowserWindow({
    width: 1280, height: 860, minWidth: 920, minHeight: 640, title: 'Beings',
    icon: path.join(app.isPackaged ? process.resourcesPath : app.getAppPath(), app.isPackaged ? 'branding/app.png' : 'resources/branding/app.png'),
    backgroundColor: process.platform === 'darwin' || acrylic ? '#00000000' : nativeTheme.shouldUseDarkColors ? '#212121' : '#ffffff',
    ...(process.platform === 'darwin' ? { vibrancy: 'sidebar' as const, visualEffectState: 'active' as const } : {}),
    ...(acrylic ? { backgroundMaterial: 'acrylic' as const } : {}),
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 18, y: 20 },
    webPreferences: { preload: path.join(__dirname, 'preload.js'), sandbox: true, contextIsolation: true,
      nodeIntegration: false, nodeIntegrationInSubFrames: false, webSecurity: true },
  });
  window.webContents.setWindowOpenHandler(({ url }) => { void openExternal(url); return { action: 'deny' }; });
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-frame-navigate', event => {
    const url = event.url;
    const parsed = new URL(url);
    const chatDocument = parsed.protocol === 'beings:' && parsed.hostname === 'chat' && parsed.pathname === '/';
    if (!chatDocument && url !== shellURL()) { event.preventDefault(); void openExternal(url); }
  });
  window.on('closed', () => { window = null; });
  void window.loadURL(shellURL());
}

async function ready() {
  let appearance: 'light' | 'dark' = 'light';
  try { const saved = JSON.parse(await readFile(path.join(app.getPath('userData'), 'appearance.json'), 'utf8')); if (saved.theme === 'dark') appearance = 'dark'; } catch { /* First launch uses the light workspace. */ }
  nativeTheme.themeSource = appearance;
  const directory = app.getPath('userData');
  const binary = app.isPackaged
    ? path.join(process.resourcesPath, process.platform === 'win32' ? 'heart-portal.exe' : 'heart-portal')
    : path.resolve('resources', process.platform === 'win32' ? 'heart-portal.exe' : 'heart-portal');
  const secretStorage = {
    isEncryptionAvailable: () => safeStorage.isEncryptionAvailable() && (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text'),
    encryptString: (value: string) => safeStorage.encryptString(value), decryptString: (value: Buffer) => safeStorage.decryptString(value),
  };
  store = new SettingsStore(directory, secretStorage, binary);
  await store.load();
  const townCredentials = new TownCredentials(directory, secretStorage);
  let townWarning: string | undefined;
  try { await townCredentials.load(); } catch (error) { townWarning = (error as Error).message; }
  townLive = new TownLive(() => townCredentials.token, () => townCredentials.beingId, state => { if (window && !window.webContents.isDestroyed()) window.webContents.send('beings:town-live', state); }, net.fetch.bind(net) as typeof fetch);
  const town = new TownClient(() => townCredentials.token, net.fetch.bind(net) as typeof fetch, TOWN_ORIGIN, () => townLive.state.beingId || '');
  townLive.restart();
  kitInstaller = new KitInstaller(directory, net.fetch.bind(net) as typeof fetch);
  portal = new PortalSupervisor(directory);
  background = new BackgroundPortal(directory);
  await background.discover(store.settings, store.connection);
  if (!background.state.supported) store.settings.backgroundEnabled = false;
  proxy = new ChatProxy(() => store.connection, net.fetch.bind(net) as typeof fetch);
  const assets = app.isPackaged ? path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}`) : path.resolve('desktop/generated');
  protocol.handle('beings', async request => {
    const url = new URL(request.url);
    if (url.hostname === 'chat' && (url.pathname.startsWith('/api/') || url.pathname === '/health')) return proxy.handle(request);
    if (!['desktop', 'chat'].includes(url.hostname) || request.method !== 'GET') return new Response('Not found', { status: 404 });
    const relative = url.hostname === 'chat'
      ? (url.pathname === '/' ? 'loom.html' : url.pathname.slice(1))
      : (url.pathname === '/' ? 'index.html' : url.pathname.slice(1));
    if (url.hostname === 'chat' && !['loom.html', 'vendor.js', 'highlight.css', 'chat.css', 'chat-index.js', 'chat-activity.js', 'chat-scene.js'].includes(relative)) return new Response('Not found', { status: 404 });
    const file = path.resolve(assets, relative);
    if (!file.startsWith(assets + path.sep)) return new Response('Forbidden', { status: 403 });
    try {
      const headers: Record<string, string> = { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' };
      if (url.hostname === 'chat') headers['Content-Security-Policy'] = chatCSP;
      return new Response(await readFile(file), { headers });
    } catch { return new Response('Not found', { status: 404 }); }
  });
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  let recoveryBlocked = false;
  // Only the trusted top-level local shell can control local capabilities.
  const handle = (channel: string, callback: (...args: any[]) => unknown) => {
    ipcMain.handle(channel, (event, ...args) => {
      const frame = event.senderFrame;
      if (!window || event.sender !== window.webContents || frame !== window.webContents.mainFrame || frame.url !== shellURL()) throw new Error('Untrusted IPC sender');
      if (recoveryBlocked && ['beings:save', 'beings:portal-start', 'beings:portal-stop', 'beings:kits-apply'].includes(channel)) throw new Error('Portal 升级恢复尚未完成，请重新启动客户端完成恢复。');
      return callback(...args);
    });
  };
  let runtimeUpdate: RuntimeUpdateResult = { phase: 'current', message: 'Portal 升级状态将在启动检查后显示。' };
  const updates = new UpdateChecker(app.getVersion(), TOWN_UPDATE_REPOSITORY, net.fetch.bind(net) as typeof fetch,
    state => { if (window && !window.isDestroyed()) window.webContents.send('beings:update-state', state); });
  let showingUpdates = false;
  const showUpdates = async () => {
    if (showingUpdates || !window) return;
    showingUpdates = true;
    try {
      const state = await updates.check();
      const answer = await dialog.showMessageBox(window, { type: state.phase === 'available' ? 'info' : 'none', title: '客户端更新',
        message: state.phase === 'available' ? `发现 Town-Client ${state.latestVersion}` : state.message,
        detail: `当前客户端：${app.getVersion()}${runtimeUpdate.portalVersion ? ` · Portal：${runtimeUpdate.portalVersion}` : ''}\n${runtimeUpdate.message}\n\n更新方式：保存草稿，退出客户端，安装新版后重新打开。首次启动会停止匹配的旧守护和 Portal，同步安装包中的引擎与守护程序，沿用配置并恢复原运行状态。执行中的本机任务会中断，请先结束任务。`,
        buttons: ['关闭', '打开发布页'], defaultId: 0, cancelId: 0 });
      if (answer.response === 1) await shell.openExternal(state.releaseUrl);
    } finally { showingUpdates = false; }
  };
  handle('beings:check-updates', showUpdates);
  handle('beings:update-state', () => updates.state);
  const snapshot = () => ({ settings: store.settings, portal: portal.state, background: background.state });
  const externalPortal = new ExternalPortalObserver();
  const observeExternal = async () => {
    const state = await externalPortal.read(store.connection);
    if (!state) return false;
    portal.state = state; portal.emit('state', state); return true;
  };
  const publishBackground = async () => {
    const state = await background.portalState();
    if (!background.state.running && await observeExternal()) return;
    portal.state = state;
    portal.emit('state', portal.state);
  };
  handle('beings:snapshot', snapshot);
  handle('beings:appearance', (theme?: 'light' | 'dark') => exclusive(async () => {
    if (theme === undefined) return appearance;
    if (theme !== 'light' && theme !== 'dark') throw new Error('无效的配色。');
    await mkdir(directory, { recursive: true });
    const file = path.join(directory, 'appearance.json');
    await writeFile(file + '.tmp', JSON.stringify({ theme })); await rename(file + '.tmp', file);
    nativeTheme.themeSource = theme; appearance = theme;
    if (process.platform !== 'darwin' && !(process.platform === 'win32' && Number(os.release().split('.')[2]) >= 22621)) window?.setBackgroundColor(theme === 'dark' ? '#212121' : '#ffffff');
    return appearance;
  }));
  handle('beings:town', async (query: TownQuery) => {
    const generation = townLive.state.generation;
    const result = await town.query(query);
    if (generation !== townLive.state.generation) return { ok: false, code: 'auth', message: 'Town 身份已变更，请刷新。' };
    if (result.ok) townLive.remember(query, result.data);
    else if (result.code === 'auth' && townCredentials.token && query.kind !== 'my-scrolls') townLive.rejectAuth();
    return result;
  });
  handle('beings:town-live', () => townLive.state);
  handle('beings:town-reconnect', () => townLive.restart());
  handle('beings:town-send', (input: TownPost) => {
    const generation = townLive.state.generation;
    return exclusive(async () => {
      if (generation !== townLive.state.generation || townLive.state.phase !== 'connected' || !townLive.state.beingId) return { ok: false, code: 'auth', message: 'Town 身份尚未确认或已变更，请重新打开发送窗口。' };
      const result = await town.send(input);
      if (!result.ok && result.code === 'auth') townLive.rejectAuth();
      return result;
    });
  });
  handle('beings:town-auth', () => ({ configured: Boolean(townCredentials.token), beingId: townLive.state.beingId, suggestedBeingId: store.settings.being, warning: townWarning }));
  handle('beings:town-pair', (input: { beingId: string; code: string }) => exclusive(async () => {
    if (!secretStorage.isEncryptionAvailable()) throw new Error('系统密钥库不可用，无法安全保存配对凭据。');
    const paired = await town.pair(input);
    await townCredentials.save(paired.token, paired.beingId);
    townWarning = undefined; townLive.restart();
  }));
  handle('beings:town-token', (token: string) => exclusive(async () => { await townCredentials.save(token); townWarning = undefined; townLive.restart(); }));
  handle('beings:town-open', async (route: string) => {
    if (typeof route !== 'string' || !/^\/(?:api\/(?:[a-z]+\/help|grove\/[a-zA-Z0-9_-]+\/download)|embers)?$/.test(route)) throw new Error('不支持的 Town 链接。');
    await shell.openExternal(TOWN_ORIGIN + route);
  });
  handle('beings:kits', () => localKits(store.settings));
  handle('beings:kit-prepare', (id: string) => exclusive(async () => {
    if (!store.connection) throw new Error('请先连接 Being，再安装本机 Kit。');
    return kitInstaller.prepare(id, store.settings);
  }));
  handle('beings:kit-install', (input: KitInstallInput) => exclusive(() => kitInstaller.install(input, store.settings)));
  handle('beings:kit-discard', (ticket: string) => exclusive(() => kitInstaller.discard(ticket)));
  handle('beings:kits-apply', () => exclusive(async () => {
    if (!store.connection) throw new Error('请先连接 Being。');
    if (portal.state.managed === false) throw new Error('当前连接的是独立 Portal，请使用原管理方式重启应用 Kits。');
    if (background.state.enabled) { await background.restart(); await publishBackground(); }
    else {
      if (portal.state.phase === 'external') throw new Error('此独立 Portal 未由客户端识别，请等待清单刷新或使用原管理方式重启。');
      await portal.stop(); await portal.start(store.settings, store.connection);
    }
    return portal.state;
  }));
  handle('beings:kits-open', async () => {
    const { directory } = await kitLocation(store.settings); await mkdir(directory, { recursive: true });
    const error = await shell.openPath(directory); if (error) throw new Error(error);
  });
  handle('beings:kit-import', () => exclusive(async () => {
    const choice = await dialog.showOpenDialog(window!, { title: '选择包含 manifest.json 的 Kit 目录', properties: ['openDirectory'] });
    if (choice.canceled) return { installed: false };
    const kit = await readKit(choice.filePaths[0]);
    const { directory } = await kitLocation(store.settings);
    if (!kit.compatible) throw new Error('这个 Kit 不支持当前系统。');
    const review = await dialog.showMessageBox(window!, { type: 'question', title: '导入 Kit',
      message: `将 ${kit.name} ${kit.version} 导入本机 Portal？`,
      detail: `${kit.description}\n\n${kit.tools.length} 个工具 · 启动命令：${kit.command.join(' ')}\n目标：${directory}\n\n导入会复制文件；依赖和密钥需要自行配置。重启 Portal 后可用。${kit.eager ? '此 Kit 会在 Portal 启动时自动运行。' : 'Being 调用工具时将以当前用户身份运行此 Kit。'}`,
      buttons: ['取消', '导入'], defaultId: 0, cancelId: 0 });
    if (review.response !== 1) return { installed: false };
    const installed = await importLocalKit(choice.filePaths[0], directory);
    return { installed: true, name: installed.name };
  }));
  handle('beings:save', (input: SaveSettings) => exclusive(async () => {
    if (!background.state.enabled && !input.backgroundEnabled && !['stopped', 'error', 'external'].includes(portal.state.phase)) throw new Error('请先停止客户端管理的 Portal，再修改连接或本机设置。');
    if (portal.state.managed === false && input.backgroundEnabled) throw new Error('当前已有独立 Portal 运行。请使用原管理方式管理后台服务，避免启动重复实例。');
    const previous = { ...store.settings }; const previousConnection = store.connection;
    await store.save(input);
    try {
      if (store.settings.backgroundEnabled) {
        await portal.stop();
        await background.enable(store.settings, store.connection!);
        await publishBackground();
      } else if (background.state.enabled) { await background.disable(); await publishBackground(); }
    } catch (error) {
      if (previousConnection) await store.save({ ...previous, connectionLink: previousConnection.link + '&relay_secret=' + encodeURIComponent(previousConnection.relaySecret) });
      throw error;
    }
    townLive?.dispose();
    proxy.abortAll(); return snapshot();
  }));
  handle('beings:choose', async (kind: string) => {
    if (!['workspace', 'binary'].includes(kind)) throw new Error('Invalid dialog');
    const result = await dialog.showOpenDialog(window!, { title: kind === 'workspace' ? '选择 Being 工作目录' : '选择 heart-portal 可执行文件',
      properties: kind === 'workspace' ? ['openDirectory', 'createDirectory'] : ['openFile'] });
    return result.canceled ? null : result.filePaths[0];
  });
  handle('beings:portal-start', () => exclusive(async () => {
    if (!portal.managing && await observeExternal()) return portal.state;
    if (!store.connection) throw new Error('请先连接 Being。');
    if (store.settings.backgroundEnabled) {
      await background.enable(store.settings, store.connection); await publishBackground(); return portal.state;
    }
    return portal.start(store.settings, store.connection);
  }));
  handle('beings:portal-stop', () => exclusive(async () => {
    if (portal.state.managed === false) throw new Error('当前 Portal 由外部管理，请使用原管理方式停止。');
    if (background.state.enabled) {
      await background.disable();
      await store.save({ ...store.settings, backgroundEnabled: false });
      await publishBackground(); return portal.state;
    }
    return portal.stop();
  }));
  handle('beings:workspace', async () => {
    if (!store.connection) throw new Error('请先保存工作目录。');
    const error = await shell.openPath(store.settings.workspace); if (error) throw new Error(error);
  });
  portal.on('state', state => { if (window && !window.isDestroyed()) window.webContents.send('beings:portal-state', state); });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
    { role: 'editMenu' }, { label: '视图', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }] },
    { role: 'windowMenu' }, { label: '帮助', submenu: [{ label: '检查更新…', click: () => { void showUpdates(); } }] },
  ]));
  createWindow();
  await exclusive(async () => {
    if (!store.connection) return;
    try {
      const updater = new RuntimeUpdater(directory, background);
      const recovered = await updater.recover();
      if (recovered) {
        runtimeUpdate = { phase: 'error', message: '已恢复上次未完成升级前的 Portal；本次启动不再自动重试升级。' };
        await publishBackground();
        return;
      }
      if (app.isPackaged) {
        const { bundle, binary: bundledBinary } = await loadRuntimeBundle(process.resourcesPath);
        runtimeUpdate = await updater.sync(bundledBinary, bundle, store.settings, store.connection);
        if (runtimeUpdate.phase !== 'skipped') {
          if (runtimeUpdate.phase === 'current' || runtimeUpdate.phase === 'updated') {
            const service = background.installedService!;
            await store.save({ ...store.settings, portalBinary: path.join(service.root, process.platform === 'win32' ? 'heart-portal.exe' : 'heart-portal'), portalConfigPath: service.configPath, workspace: service.cwd || store.settings.workspace, portalEnvironmentPath: service.environment?.PATH || store.settings.portalEnvironmentPath, portalName: service.name || store.settings.portalName });
          }
          await publishBackground();
          // The completed upgrade owns and starts the replacement service.
          return;
        }
        if (await observeExternal()) {
          runtimeUpdate = { phase: 'skipped', message: '发现未能确认管理方式的独立 Portal，未改动其进程和文件。请先迁入客户端管理。' };
          return;
        }
        await store.save({ ...store.settings, portalBinary: bundledBinary });
        runtimeUpdate = { phase: 'current', message: '已选择随客户端附带的 Portal，下次启动按原配置运行。', portalVersion: bundle.portalVersion };
      }
      if (store.settings.backgroundEnabled || store.settings.autoStart) {
        if (await observeExternal()) { /* Only identity-verified supervision is migrated. */ }
        else if (store.settings.backgroundEnabled) {
          await background.enable(store.settings, store.connection); await publishBackground();
        } else await portal.start(store.settings, store.connection);
      }
    } catch (error) {
      recoveryBlocked = await access(path.join(directory, 'runtime-update.json')).then(() => true, () => false);
      runtimeUpdate = { phase: 'error', message: String(error) };
      portal.state = { phase: 'error', message: `Portal 更新或启动未完成：${(error as Error).message}`, logs: [] };
      portal.emit('state', portal.state);
      if (!quitting && window) void dialog.showMessageBox(window, { type: 'warning', title: 'Portal 更新未完成', message: runtimeUpdate.message, buttons: ['知道了'] });
    }
  });
  if (app.isPackaged && !process.env.BEINGS_USER_DATA) {
    void updates.check();
    updatePoll = setInterval(() => { void updates.check(); }, 6 * 60 * 60 * 1000);
    updatePoll.unref();
  }
  let pollingBackground = false;
  backgroundPoll = setInterval(() => {
    if (quitting || pollingBackground || portal.managing || !store.connection) return;
    pollingBackground = true;
    void exclusive(publishBackground).catch(() => {
      portal.state = { phase: 'error', message: '无法读取后台服务状态，请在本机设置中重新启用。', logs: [] };
      portal.emit('state', portal.state);
    }).finally(() => { pollingBackground = false; });
  }, 3000);
  backgroundPoll.unref();
}
const squirrelEvent = process.platform === 'win32' ? installerEvent(process.argv) : undefined;
if (squirrelEvent) { void handleInstallerEvent(squirrelEvent, process.execPath).catch(() => { process.exitCode = 1; }).finally(() => app.quit()); }
else if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { window?.restore(); window?.focus(); });
  app.whenReady().then(ready).catch(error => { dialog.showErrorBox('Beings 启动失败', String(error)); app.quit(); });
  app.on('activate', () => { if (!window && store) createWindow(); });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', event => {
    if (quitting || !portal) return;
    event.preventDefault(); quitting = true;
    clearInterval(backgroundPoll); clearInterval(updatePoll);
    townLive?.dispose();
    proxy.abortAll();
    void exclusive(async () => { await kitInstaller.dispose(); await portal.stop(); }).finally(() => app.quit());
  });
}
