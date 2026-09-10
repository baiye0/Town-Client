import { createHash, randomUUID } from 'node:crypto';
import { access, chmod, copyFile, mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { BackgroundPortal, atomic, command, fingerprint, unixRunner, windowsRunner, type Service } from './background';
import type { Connection } from './connection';
import type { Settings } from './shared';
import { readPortalSample } from './portal-status';

export interface RuntimeBundle { schema: 1; id: string; clientVersion: string; portalVersion: string; sha256: string; platform: string; arch: string }
interface Journal { schema: 1; previous: Service; candidate: Service; enabled: boolean; previousPlist?: string }
export interface RuntimeUpdateResult { phase: 'current' | 'updated' | 'skipped' | 'error'; message: string; portalVersion?: string }
export const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
export function compareVersions(left: string, right: string) {
  const parse = (value: string) => {
    const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(value);
    if (!match) throw new Error('无效的稳定版版本号。');
    return match.slice(1).map(Number);
  };
  const a = parse(left), b = parse(right);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  return 0;
}
export async function loadRuntimeBundle(resources: string): Promise<{ bundle: RuntimeBundle; binary: string }> {
  const bundle = JSON.parse(await readFile(path.join(resources, 'runtime-bundle.json'), 'utf8')) as RuntimeBundle;
  if (bundle.schema !== 1 || bundle.platform !== process.platform || bundle.arch !== process.arch ||
      !/^[a-f0-9]{64}$/.test(bundle.sha256) || !/^[a-f0-9]{64}$/.test(bundle.id)) throw new Error('安装包中的 Portal 版本清单无效。');
  compareVersions(bundle.portalVersion, bundle.portalVersion);
  const binary = path.join(resources, process.platform === 'win32' ? 'heart-portal.exe' : 'heart-portal');
  if (digest(await readFile(binary)) !== bundle.sha256) throw new Error('安装包内 Portal 校验失败，旧服务未修改。');
  return { bundle, binary };
}

// Only invoked under the main process mutation queue and Electron's profile lock.
// Journal precedes any stop; recovery always restores the old registration first.
export class RuntimeUpdater {
  private journal: string;
  constructor(private directory: string, private background: BackgroundPortal,
    private platform = process.platform,
    private ready: (service: Service) => Promise<void> = service => this.waitReady(service),
    private version: (binary: string) => Promise<string> = async binary => {
      const output = await command(binary, ['--version']);
      const match = /\b(\d+\.\d+\.\d+)\b/.exec(output);
      if (!match) throw new Error('无法识别原 Portal 版本，未停止服务。');
      return match[1];
    }) { this.journal = path.join(directory, 'runtime-update.json'); }

  async recover() {
    let transaction: Journal;
    try { transaction = JSON.parse(await readFile(this.journal, 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
    if (transaction.schema !== 1 || !transaction.previous || !transaction.candidate) throw new Error('升级恢复记录损坏，请保留运行目录并检查日志。');
    const staging = path.join(this.directory, 'portal-service');
    if (path.dirname(transaction.candidate.root) !== staging || transaction.candidate.root === transaction.previous.root ||
        transaction.candidate.existing || transaction.candidate.kind || !path.isAbsolute(transaction.previous.root) ||
        transaction.candidate.label !== transaction.previous.label ||
        (transaction.candidate.file !== transaction.previous.file && transaction.candidate.file !== path.join(transaction.candidate.root, 'launch.plist'))) {
      throw new Error('升级恢复记录路径无效，未修改服务。');
    }
    await this.restore(transaction);
    return true;
  }
  private async restore(t: Journal) {
    // Never start the old engine until the candidate's entire service is stopped.
    await this.background.unload(t.candidate);
    if (t.previous.kind === 'portable') {
      if (this.platform === 'darwin') await rm(t.candidate.file, { force: true });
    } else if (this.platform === 'darwin') {
      if (t.previousPlist === undefined) throw new Error('旧服务登记备份缺失。');
      await atomic(t.previous.file, t.previousPlist);
      if (t.candidate.file !== t.previous.file) await rm(t.candidate.file, { force: true });
    } else await this.background.installRegistration(t.previous);
    if (t.enabled) await this.background.load(t.previous);
    await this.background.setService(t.previous);
    await rm(this.journal);
    // Keep files until recovery is committed; never delete the original config.
    await rm(t.candidate.root, { recursive: true, force: true });
  }
  async sync(binary: string, bundle: RuntimeBundle, settings: Settings, connection: Connection): Promise<RuntimeUpdateResult> {
    const previous = this.background.installedService;
    if (!previous) return { phase: 'skipped', message: '尚未安装客户端管理的后台服务。' };
    if (previous.bundleId === bundle.id && digest(await readFile(path.join(previous.root, this.platform === 'win32' ? 'heart-portal.exe' : 'heart-portal'))) === bundle.sha256) return { phase: 'current', message: '客户端、Portal 与守护程序已同步。', portalVersion: bundle.portalVersion };
    if (digest(await readFile(binary)) !== bundle.sha256) throw new Error('Portal 文件校验失败，旧服务未修改。');
    const oldBinary = previous.binary || (previous.existing ? settings.portalBinary : path.join(previous.root, this.platform === 'win32' ? 'heart-portal.exe' : 'heart-portal'));
    const oldVersion = await this.version(oldBinary);
    if (compareVersions(oldVersion, bundle.portalVersion) > 0) return { phase: 'skipped', message: `正在使用的 Portal ${oldVersion} 比安装包 ${bundle.portalVersion} 更新，已保留，未降级。`, portalVersion: oldVersion };
    const config = previous.configPath || settings.portalConfigPath || path.join(previous.root, 'portal.toml');
    await access(config);
    const wasEnabled = (await this.background.refresh()).enabled;
    const root = path.join(this.directory, 'portal-service', randomUUID());
    const candidate: Service = { label: previous.label, file: previous.kind === 'portable' ? path.join(root, 'launch.plist') : previous.file, root, existing: false, login: previous.login,
      bundleId: bundle.id, configPath: config, cwd: previous.cwd || (previous.existing ? previous.root : settings.workspace),
      fingerprint: fingerprint({ ...settings, portalBinary: binary }, connection) };
    await mkdir(root, { recursive: true, mode: 0o700 });
    try {
      const target = path.join(root, this.platform === 'win32' ? 'heart-portal.exe' : 'heart-portal');
      await copyFile(binary, target); await chmod(target, 0o700);
      if (digest(await readFile(target)) !== bundle.sha256) throw new Error('暂存 Portal 校验失败。');
      // Preserve stored credentials exactly for already-owned services.
      if (!previous.existing) await copyFile(path.join(previous.root, this.platform === 'win32' ? 'connection.dpapi' : 'connection.url'), path.join(root, this.platform === 'win32' ? 'connection.dpapi' : 'connection.url'));
      else await this.background.protectCredential(root, connection);
      const launchSettings = { ...settings, workspace: candidate.cwd! };
      await atomic(path.join(root, this.platform === 'win32' ? 'run.ps1' : 'run.sh'), this.platform === 'win32'
        ? '\ufeff' + windowsRunner(root, config, launchSettings) : unixRunner(root, config, launchSettings));
      await atomic(path.join(root, 'runtime-bundle.json'), JSON.stringify(bundle));
      const transaction: Journal = { schema: 1, previous, candidate, enabled: wasEnabled,
        ...(this.platform === 'darwin' && previous.kind !== 'portable' ? { previousPlist: await readFile(previous.file, 'utf8') } : {}) };
      await atomic(this.journal, JSON.stringify(transaction));
    } catch (error) { await rm(root, { recursive: true, force: true }); throw error; }
    try {
      await this.background.unload(previous);
      await this.background.installRegistration(candidate);
      if (wasEnabled) {
        await this.background.load(candidate);
        await this.background.setService(candidate);
        await this.ready(candidate);
      } else {
        // Registration defaults to enabled on Windows; preserve an explicit stop.
        await this.background.unload(candidate);
      }
      await this.background.setService(candidate);
      await rm(this.journal);
      return { phase: 'updated', message: wasEnabled ? 'Portal 与守护程序已更新，已按原配置重新启动。' : 'Portal 与守护程序已更新，保持原来的停用状态。', portalVersion: bundle.portalVersion };
    } catch (error) {
      try { await this.recover(); }
      catch (recovery) { throw new Error(`升级失败且恢复未完成；下次启动将重试恢复。${String(recovery)}`); }
      throw new Error(`Portal 更新失败，已恢复旧服务：${String(error)}`);
    }
  }
  private async waitReady(service: Service) {
    const deadline = Date.now() + 25_000;
    let identity = '', since = 0;
    while (Date.now() < deadline) {
      const state = await this.background.refresh();
      const nonce = await readFile(path.join(service.root, '.portal-status-nonce'), 'utf8').catch(() => '');
      const sample = state.running && state.pid ? await readPortalSample(path.join(service.root, '.portal-connection-status.json'), state.pid, nonce.trim()) : null;
      // Cloud availability is not an installation health test.
      if (sample && !['starting', 'invalid'].includes(sample.state)) {
        const current = `${sample.pid}:${sample.boot_id}`;
        if (identity !== current) { identity = current; since = Date.now(); }
        if (Date.now() - since >= 2000) return;
      } else { identity = ''; since = 0; }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new Error('新 Portal 未通过本地启动检查。');
  }
}
