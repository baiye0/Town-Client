import { spawn } from 'node:child_process';
import { access, chmod, copyFile, mkdir, open, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { parseConnection, redact, type Connection } from './connection';
import { portalConfig } from './portal';
import { readPortalSample, portalSampleState } from './portal-status';
import type { BackgroundState, PortalState, Settings } from './shared';

// No shell interpolation or credentials in command arguments. Windows DPAPI input uses stdin.
export type Command = (file: string, args: string[], input?: string) => Promise<string>;
export const command: Command = (file, args, input) => new Promise((resolve, reject) => {
  const child = spawn(file, args, { windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = ''; let stderr = '';
  const timer = setTimeout(() => { child.kill(); reject(new Error(`${path.basename(file)} 超时`)); }, 30_000);
  child.stdout.on('data', data => { stdout = (stdout + data).slice(-256_000); });
  child.stderr.on('data', data => { stderr = (stderr + data).slice(-8000); });
  child.on('error', error => { clearTimeout(timer); reject(error); });
  child.on('close', code => { clearTimeout(timer); code === 0 ? resolve(stdout) : reject(new Error(`${path.basename(file)} (${code}): ${redact(stderr)}`)); });
  child.stdin.on('error', () => {}); child.stdin.end(input);
});
const sh = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
const ps = (value: string) => `'${value.replaceAll("'", "''")}'`;
// A Node/Electron parent launched by pwsh inherits PS7 module paths. Native
// Windows PowerShell must load its own compatible management/security modules.
export const windowsModulePath = '$env:PSModulePath = "$PSHOME\\Modules"; ';
const xml = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
const hash = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 16);
export interface Service { label: string; file: string; root: string; existing: boolean; kind?: 'portable'; login?: boolean; name?: string; environmentPath?: string; environment?: Record<string, string>; fingerprint?: string; bundleId?: string; configPath?: string; cwd?: string; binary?: string }
export function fingerprint(settings: Settings, connection: Connection) {
  return hash(JSON.stringify([connection.link, settings.portalBinary, settings.portalConfigPath, settings.portalName,
    settings.workspace, settings.portalEnvironmentPath, settings.allowExec, settings.kitsEnabled, "status-v1"]));
}
export function launchAgent(label: string, root: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict>
<key>Label</key><string>${xml(label)}</string><key>ProgramArguments</key><array><string>/bin/sh</string><string>${xml(path.join(root, 'run.sh'))}</string></array>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>5</integer><key>ExitTimeOut</key><integer>15</integer><key>AbandonProcessGroup</key><false/><key>Umask</key><integer>63</integer>
<key>StandardOutPath</key><string>${xml(path.join(root, 'supervisor.log'))}</string><key>StandardErrorPath</key><string>${xml(path.join(root, 'supervisor.err.log'))}</string>
</dict></plist>`;
}
function environmentEntries(environment: Record<string, string>) {
  return Object.entries(environment).filter(([key, value]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && typeof value === 'string' && !value.includes('\0'));
}
export function unixRunner(root: string, config: string, settings: Settings, environment: Record<string, string> = {}): string {
  return `#!/bin/sh\nset -eu\numask 077\n${environmentEntries(environment).map(([key, value]) => `export ${key}=${sh(value)}\n`).join('')}cd ${sh(settings.workspace)}\nexport PATH=${sh(settings.portalEnvironmentPath || environment.PATH || process.env.PATH || '/usr/local/bin:/usr/bin:/bin')}\nexport PORTAL_CONNECT_LINK="$(cat ${sh(path.join(root, 'connection.url'))})"\nexport HEART_PORTAL_SUPERVISED=1 RUST_LOG=info NO_COLOR=1\n` +
    `export HEART_PORTAL_STATUS_FILE=${sh(path.join(root, '.portal-connection-status.json'))}\nexport HEART_PORTAL_STATUS_NONCE="$(/usr/bin/uuidgen)"\nprintf '%s' "$HEART_PORTAL_STATUS_NONCE" >${sh(path.join(root, '.portal-status-nonce'))}\n` +
    `for log in ${sh(path.join(root, 'portal.log'))} ${sh(path.join(root, 'portal.err.log'))}; do [ ! -f "$log" ] || mv -f "$log" "$log.previous"; done\n` +
    `exec ${sh(path.join(root, 'heart-portal'))} --config ${sh(config)} --name ${sh(settings.portalName)} >${sh(path.join(root, 'portal.log'))} 2>${sh(path.join(root, 'portal.err.log'))}\n`;
}
export function windowsRunner(root: string, config: string, settings: Settings, environment: Record<string, string> = {}): string {
  // The scheduled task owns this process tree; it has no client/Electron dependency.
  return `$ErrorActionPreference = 'Stop'\n$root = ${ps(root)}\n` +
`${environmentEntries(environment).map(([key, value]) => `$env:${key}=${ps(value)}\n`).join('')}${windowsModulePath}$env:PORTAL_CONNECT_LINK = [System.Net.NetworkCredential]::new('', (Get-Content -LiteralPath (Join-Path $root 'connection.dpapi') -Raw | ConvertTo-SecureString)).Password
$PID | Set-Content -LiteralPath (Join-Path $root 'supervisor.pid')
$env:HEART_PORTAL_SUPERVISED = '1'
$env:RUST_LOG = 'info'
$env:NO_COLOR = '1'
$env:PATH = ${ps(settings.portalEnvironmentPath || environment.PATH || process.env.PATH || '')}
Set-Location -LiteralPath ${ps(settings.workspace)}
while ($true) {
  $child = $null
  try {
    $env:HEART_PORTAL_STATUS_FILE = Join-Path $root '.portal-connection-status.json'
    $env:HEART_PORTAL_STATUS_NONCE = [Guid]::NewGuid().ToString()
    [IO.File]::WriteAllText((Join-Path $root '.portal-status-nonce'), $env:HEART_PORTAL_STATUS_NONCE)
    $si = New-Object System.Diagnostics.ProcessStartInfo
    $si.FileName = Join-Path $root 'heart-portal.exe'
    $si.Arguments = ${ps('--config ' + windowsArgument(config) + ' --name ' + windowsArgument(settings.portalName))}
    $si.WorkingDirectory = ${ps(settings.workspace)}
    $si.UseShellExecute = $false
    $si.CreateNoWindow = $true
    $si.RedirectStandardOutput = $true
    $si.RedirectStandardError = $true
    $out = [System.IO.File]::Open((Join-Path $root 'portal.log'), 'Create', 'Write', 'ReadWrite')
    $err = [System.IO.File]::Open((Join-Path $root 'portal.err.log'), 'Create', 'Write', 'ReadWrite')
    $child = [System.Diagnostics.Process]::Start($si)
    $child.Id | Set-Content -LiteralPath (Join-Path $root 'pid')
    $outCopy = $child.StandardOutput.BaseStream.CopyToAsync($out)
    $errCopy = $child.StandardError.BaseStream.CopyToAsync($err)
    $child.WaitForExit()
    if (-not $outCopy.Wait(1000)) { $child.StandardOutput.Close() }
    if (-not $errCopy.Wait(1000)) { $child.StandardError.Close() }
  } catch { $_ | Out-String | Set-Content -LiteralPath (Join-Path $root 'supervisor.err.log') }
  finally {
    if ($child) { if (-not $child.HasExited) { $child.Kill() }; $child.Dispose() }
    if ($out) { $out.Dispose() }; if ($err) { $err.Dispose() }
  }
  Start-Sleep -Seconds 5
}
`;
}
export function windowsArgument(value: string) { return '"' + value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1') + '"'; }
export async function atomic(file: string, contents: string) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = file + '.' + randomUUID();
  const handle = await open(temp, 'wx', 0o600);
  try { await handle.writeFile(contents); await handle.sync(); }
  finally { await handle.close(); }
  await rename(temp, file);
  if (process.platform !== 'win32') {
    const parent = await open(path.dirname(file), 'r');
    try { await parent.sync(); } finally { await parent.close(); }
  }
}
async function tail(file: string) {
  try {
    const handle = await open(file, 'r');
    try { const { size } = await handle.stat(); const data = Buffer.alloc(Math.min(size, 64_000)); await handle.read(data, 0, data.length, Math.max(0, size - data.length)); return data.toString(); }
    finally { await handle.close(); }
  } catch { return ''; }
}

export class BackgroundPortal {
  private service: Service | null = null;
  private connection: Connection | null = null;
  state: BackgroundState;
  readonly label: string;
  constructor(private directory: string, private run: Command = command, private platform = process.platform, private home = os.homedir()) {
    this.label = `town.beings.desktop.portal.${hash(path.resolve(directory))}`;
    this.state = { supported: ['darwin', 'win32'].includes(platform), installed: false, enabled: false, running: false, existing: false,
      message: ['darwin', 'win32'].includes(platform) ? '未启用后台服务' : '此版本的后台服务支持 macOS 和 Windows' };
  }
  private get domain() { return `gui/${process.getuid?.() ?? 0}`; }
  private powershell(script: string, input?: string) {
    return this.run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(windowsModulePath + "$ErrorActionPreference='Stop'; " + script, 'utf16le').toString('base64')], input);
  }
  async discover(settings: Settings, connection: Connection | null) {
    this.connection = connection;
    try { this.service = JSON.parse(await readFile(path.join(this.directory, 'portal-service.json'), 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (this.service && this.platform === 'darwin' && this.service.kind !== 'portable') {
      try { await access(this.service.file); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') this.service = null; else throw error; }
    }
    if (!this.service && this.platform === 'darwin' && settings.portalConfigPath && connection) {
      const root = path.dirname(settings.portalConfigPath);
      const agents = path.join(this.home, 'Library/LaunchAgents');
      for (const name of await readdir(agents).catch(() => [])) {
        if (!/^town\.beings\.heart-portal\.[a-f0-9]+\.plist$/.test(name)) continue;
        try {
          const file = path.join(agents, name);
          const data = JSON.parse(await this.run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', file]));
          if (data.WorkingDirectory !== root || data.Label !== name.slice(0, -6) || !data.KeepAlive || !data.RunAtLoad) continue;
          if (!data.ProgramArguments?.includes(path.join(root, 'scripts/portal-launchagent.sh'))) continue;
          const link = parseConnection(await readFile(path.join(root, '.portal-connection.url'), 'utf8'));
          if (link.link !== connection.link) continue;
          this.service = { label: data.Label, root, file, existing: true, cwd: root, environment: Object.fromEntries(environmentEntries(data.EnvironmentVariables || {})), fingerprint: fingerprint(settings, connection) };
          await atomic(path.join(this.directory, 'portal-service.json'), JSON.stringify(this.service));
          break;
        } catch { /* Unrelated or unreadable services are never modified. */ }
      }
    }
    if (!this.service && connection && settings.portalConfigPath && this.platform === 'darwin') {
      const root = path.dirname(settings.portalConfigPath);
      try {
        await access(path.join(root, '.portal-supervisor.json'));
        const resolved = await realpath(settings.portalBinary);
        const expectedRoot = path.basename(path.dirname(resolved)) === 'release' && path.basename(path.dirname(path.dirname(resolved))) === 'target'
          ? path.dirname(path.dirname(path.dirname(resolved))) : path.dirname(resolved);
        if (expectedRoot !== await realpath(root)) return this.refresh();
        const savedLink = parseConnection(await readFile(path.join(root, '.portal-connection.url'), 'utf8'));
        const savedName = (await readFile(path.join(root, '.portal-name'), 'utf8')).trim();
        if (savedLink.link === connection.link && savedName === settings.portalName) {
          const status = JSON.parse(await this.run(settings.portalBinary, ['status']));
          if (this.platform === 'darwin' && status.supervisor?.kind === 'inherited-session' && !status.launchagent_loaded && Array.isArray(status.portal_pids) && status.portal_pids.length === 1) {
            this.service = { label: this.label, root, file: '', existing: true, kind: 'portable', login: false,
              binary: settings.portalBinary, configPath: settings.portalConfigPath, cwd: settings.workspace,
              name: settings.portalName, environmentPath: settings.portalEnvironmentPath, fingerprint: fingerprint(settings, connection) };
          }
        }
      } catch { /* Unknown supervision cannot be safely replaced. */ }
    }
    return this.refresh();
  }
  async refresh(): Promise<BackgroundState> {
    const service = this.service;
    if (!service) return this.state;
    let enabled = false, running = false, loaded = true, pid: number | undefined;
    if (service.kind === 'portable') {
      const status = JSON.parse(await this.run(service.binary!, ['status']));
      running = Array.isArray(status.portal_pids) && status.portal_pids.length === 1 && Boolean(status.supervisor);
      enabled = running; pid = running ? status.portal_pids[0] : undefined;
    } else if (this.platform === 'darwin') {
      await access(service.file); // Missing registration must not be presented as healthy.
      const disabled = await this.run('/bin/launchctl', ['print-disabled', this.domain]);
      const entry = disabled.split('\n').find(line => line.includes(`"${service.label}"`));
      enabled = !entry || !/=>\s*(?:true|disabled)\b/.test(entry);
      const status = await this.run('/bin/launchctl', ['print', `${this.domain}/${service.label}`]).catch(() => '');
      loaded = Boolean(status); enabled = enabled && loaded;
      running = /state = running/.test(status); pid = Number(status.match(/\bpid = (\d+)/)?.[1]) || undefined;
    } else if (this.platform === 'win32') {
      const status = JSON.parse(await this.powershell(`$t=Get-ScheduledTask -TaskName ${ps(service.label)};
$childRunning=$false; $portalId=0; $pidFile=${ps(path.join(service.root, 'pid'))};
if ([string]$t.State -eq 'Running' -and (Test-Path -LiteralPath $pidFile)) {
  if ([int]::TryParse((Get-Content -LiteralPath $pidFile -Raw).Trim(), [ref]$portalId)) {
    $p=Get-Process -Id $portalId -ErrorAction SilentlyContinue;
    $childRunning=($null -ne $p -and $p.Path -eq ${ps(path.join(service.root, 'heart-portal.exe'))});
  }
}
@{ enabled=$t.Settings.Enabled; running=$childRunning; pid=$portalId } | ConvertTo-Json -Compress`));
      enabled = status.enabled; running = status.running;
      if (running) pid = Number(status.pid) || undefined;
    }
    this.state = { supported: this.state.supported, installed: true, enabled, running, existing: service.existing, label: service.label, pid,
      message: !loaded ? '已登记的旧后台服务当前未加载；独立 Portal 状态另行识别' : enabled ? `登录后自动启动 · 退出客户端后继续运行 · 异常退出自动重启${service.existing ? '（沿用已有服务）' : ''}` : '后台服务已停用，不会随登录启动' };
    return this.state;
  }
  async portalState(): Promise<PortalState> {
    await this.refresh();
    if (!this.service) return { phase: 'stopped', message: this.state.message, logs: [] };
    const root = this.service.root;
    const logName = this.service.existing ? 'portal-runtime' : 'portal';
    const text = await tail(path.join(root, logName + '.log'));
    const errors = await tail(path.join(root, logName + '.err.log'));
    const secrets = this.connection ? [this.connection.token, this.connection.relaySecret] : [];
    const logs = redact(text + '\n' + errors, secrets).split(/\r?\n/).filter(Boolean).slice(-300);
    const nonce = (await readFile(path.join(root, '.portal-status-nonce'), 'utf8')
      .catch(() => readFile(path.join(root, '.portal-launch-nonce'), 'utf8')).catch(() => '')).trim();
    const sample = this.state.running && this.state.pid
      ? await readPortalSample(path.join(root, '.portal-connection-status.json'), this.state.pid, nonce) : null;
    const state = portalSampleState(sample);
    return { ...state, phase: !this.state.enabled || !this.state.running ? 'stopped' : state.phase,
      pid: this.state.pid, message: !this.state.enabled ? this.state.message : this.state.running ? state.message : '后台 Portal 当前未运行；尚未确认自动恢复', logs };
  }
  async enable(settings: Settings, connection: Connection) {
    if (!this.state.supported) throw new Error(this.state.message);
    this.connection = connection;
    const signature = fingerprint(settings, connection);
    const previous = this.service;
    if (previous?.existing && previous.fingerprint !== signature) throw new Error('当前沿用已有系统服务。请在原 Portal 配置中更新连接、名称或运行路径，客户端不会覆盖原服务配置。');
    if (previous && (previous.existing || previous.fingerprint === signature)) {
      await this.load(previous); return this.refresh();
    }
    await access(settings.portalBinary, this.platform === 'win32' ? constants.F_OK : constants.X_OK);
    if (settings.portalConfigPath) await access(settings.portalConfigPath, constants.R_OK);
    const root = path.join(this.directory, 'portal-service', randomUUID());
    await mkdir(root, { recursive: true, mode: 0o700 });
    let registrationChanged = false;
    let wasEnabled = false;
    let oldPlist: string | undefined;
    const service: Service = { label: this.label, root, existing: false, fingerprint: signature,
      file: this.platform === 'darwin' ? path.join(this.home, 'Library/LaunchAgents', this.label + '.plist') : '' };
    try {
      const binary = path.join(root, this.platform === 'win32' ? 'heart-portal.exe' : 'heart-portal');
      await copyFile(settings.portalBinary, binary); await chmod(binary, 0o700);
      const config = settings.portalConfigPath || path.join(root, 'portal.toml');
      service.configPath = config; service.cwd = settings.workspace;
      if (!settings.portalConfigPath) await atomic(config, portalConfig(settings));
      if (this.platform === 'darwin') {
        await atomic(path.join(root, 'connection.url'), connection.link);
        await atomic(path.join(root, 'run.sh'), unixRunner(root, config, settings));
        oldPlist = await readFile(service.file, 'utf8').catch(() => undefined);
      } else {
        const encrypted = await this.powershell(`[Console]::In.ReadToEnd() | ConvertTo-SecureString -AsPlainText -Force | ConvertFrom-SecureString`, connection.link);
        await atomic(path.join(root, 'connection.dpapi'), encrypted.trim());
        await atomic(path.join(root, 'run.ps1'), '\ufeff' + windowsRunner(root, config, settings));
      }
      if (previous) { wasEnabled = (await this.refresh()).enabled; await this.unload(previous); }
      registrationChanged = true;
      if (this.platform === 'darwin') await atomic(service.file, launchAgent(service.label, root));
      else await this.registerWindows(service);
      await this.load(service);
      this.service = service;
      await this.refresh();
      // Persist ownership only after registration succeeds. Stable runtime survives app moves/updates.
      await atomic(path.join(this.directory, 'portal-service.json'), JSON.stringify(service));
      // Keep the previous runtime: it may still own the original configuration.
      return this.state;
    } catch (error) {
      if (registrationChanged) {
        await this.unload(service).catch(() => {});
        if (this.platform === 'darwin') {
          if (oldPlist) await atomic(service.file, oldPlist); else await rm(service.file, { force: true });
        } else if (previous) await this.registerWindows(previous);
        else await this.powershell(`Unregister-ScheduledTask -TaskName ${ps(service.label)} -Confirm:$false`).catch(() => {});
        if (previous && wasEnabled) await this.load(previous);
      }
      this.service = previous;
      if (previous) await this.refresh();
      else this.state = { supported: true, installed: false, enabled: false, running: false, existing: false, message: '后台服务安装失败，请重试' };
      await rm(root, { recursive: true, force: true });
      throw error;
    }
  }
  async registerWindows(service: Service) {
    const args = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File ' + windowsArgument(path.join(service.root, 'run.ps1'));
    await this.powershell(`$user=[System.Security.Principal.WindowsIdentity]::GetCurrent().Name;
$a=New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ${ps(args)};
${service.login === false ? '' : '$t=New-ScheduledTaskTrigger -AtLogOn -User $user;'}
$p=New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited;
$s=New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable;
Register-ScheduledTask -TaskName ${ps(service.label)} -Action $a ${service.login === false ? '' : '-Trigger $t'} -Principal $p -Settings $s -Force | Out-Null`);
  }
  async load(service: Service) {
    if (service.kind === 'portable') {
      if (!this.connection) throw new Error('恢复原 Portal 缺少连接配置。');
      const child = spawn(service.binary!, ['--config', service.configPath!, '--name', service.name!], {
        cwd: service.cwd, detached: true, stdio: 'ignore', windowsHide: true,
        env: { ...process.env, ...(service.environmentPath ? { PATH: service.environmentPath } : {}), PORTAL_CONNECT_LINK: this.connection.link, HEART_PORTAL_SUPERVISED: undefined },
      });
      await new Promise<void>((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
      child.unref();
      return;
    }
    if (this.platform === 'darwin') {
      await this.run('/bin/launchctl', ['enable', `${this.domain}/${service.label}`]);
      const loaded = await this.run('/bin/launchctl', ['print', `${this.domain}/${service.label}`]).then(() => true, () => false);
      if (!loaded) {
        // bootout can return while launchd is still releasing the old job.
        for (let attempt = 0; ; attempt++) {
          try { await this.run('/bin/launchctl', ['bootstrap', this.domain, service.file]); break; }
          catch (error) {
            if (attempt >= 19 || !/\(5\)/.test(String(error))) throw error;
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        }
      }
    } else await this.powershell(`Enable-ScheduledTask -TaskName ${ps(service.label)} | Out-Null; Start-ScheduledTask -TaskName ${ps(service.label)}`);
  }
  async unload(service: Service) {
    if (service.kind === 'portable') {
      await this.run(service.binary!, ['stop']);
      const status = JSON.parse(await this.run(service.binary!, ['status']));
      if (status.supervisor || status.portal_pids?.length) throw new Error('原 Portal 或守护程序尚未退出。');
      return;
    }
    if (this.platform === 'darwin') {
      await this.run('/bin/launchctl', ['disable', `${this.domain}/${service.label}`]);
      const loaded = await this.run('/bin/launchctl', ['print', `${this.domain}/${service.label}`]).then(() => true, () => false);
      if (loaded) {
        await this.run('/bin/launchctl', ['bootout', `${this.domain}/${service.label}`]);
        for (let attempt = 0; ; attempt++) {
          const present = await this.run('/bin/launchctl', ['print', `${this.domain}/${service.label}`]).then(() => true, () => false);
          if (!present) break;
          if (attempt >= 60) throw new Error('旧 Portal 服务尚未退出，已中止切换。');
          await new Promise(resolve => setTimeout(resolve, 250));
        }
      }
    } else await this.powershell(`Disable-ScheduledTask -TaskName ${ps(service.label)} | Out-Null; Stop-ScheduledTask -TaskName ${ps(service.label)};
$pidFile=${ps(path.join(service.root, 'pid'))};
if (Test-Path -LiteralPath $pidFile) {
  $portalId=0; if ([int]::TryParse((Get-Content -LiteralPath $pidFile -Raw).Trim(), [ref]$portalId)) {
    $p=Get-CimInstance Win32_Process -Filter "ProcessId = $portalId";
    if ($p -and $p.ExecutablePath -eq ${ps(path.join(service.root, 'heart-portal.exe'))}) {
      & taskkill.exe /PID $portalId /T /F | Out-Null;
      if ($LASTEXITCODE -ne 0 -and (Get-Process -Id $portalId -ErrorAction SilentlyContinue)) { throw 'Portal process tree did not stop' }
      Wait-Process -Id $portalId -Timeout 15 -ErrorAction SilentlyContinue;
      if (Get-Process -Id $portalId -ErrorAction SilentlyContinue) { throw 'Portal is still running' }
    }
  }
}`);
  }
  get installedService(): Service | null { return this.service; }
  async setService(service: Service) {
    await atomic(path.join(this.directory, 'portal-service.json'), JSON.stringify(service));
    this.service = service;
    return this.refresh();
  }
  async installRegistration(service: Service) {
    if (this.platform === 'darwin') await atomic(service.file, launchAgent(service.label, service.root));
    else await this.registerWindows(service);
  }
  async protectCredential(root: string, connection: Connection) {
    if (this.platform === 'darwin') await atomic(path.join(root, 'connection.url'), connection.link);
    else {
      const encrypted = await this.powershell(`[Console]::In.ReadToEnd() | ConvertTo-SecureString -AsPlainText -Force | ConvertFrom-SecureString`, connection.link);
      await atomic(path.join(root, 'connection.dpapi'), encrypted.trim());
    }
  }
  async disable() { if (this.service) await this.unload(this.service); return this.refresh(); }
  async restart() {
    if (!this.service || !this.state.enabled) throw new Error('后台 Portal 尚未启用。');
    if (this.platform === 'darwin') await this.run('/bin/launchctl', ['kickstart', '-k', `${this.domain}/${this.service.label}`]);
    else { await this.unload(this.service); await this.load(this.service); }
    return this.refresh();
  }
}
