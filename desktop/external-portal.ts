import { access, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { command, portableCommand, windowsModulePath, type Command, type Service } from './background';
import macLaunch from './mac-launch.py?raw';
import { parseConnection, type Connection } from './connection';
import type { PortalState } from './shared';
import { readPortalSample, portalSampleState } from './portal-status';

// Read-only discovery. Finding a process does not grant the desktop ownership of it.
export class ExternalPortalObserver {
  constructor(private run: Command = command, private platform = process.platform) {}
  // Upgrade ownership is explicit: same OS user, live binary and exact Being
  // credential, plus the original launch configuration. Stop through its CLI.
  async forUpgrade(connection: Connection, label: string, excludeRoot?: string): Promise<Service[]> {
    let processes: { pid: number; binary: string }[];
    if (this.platform === 'darwin') {
      const listing = await this.run('/bin/ps', ['-axo', 'pid=,uid=,comm=']);
      processes = listing.split('\n').flatMap(line => {
        const m = /^\s*(\d+)\s+(\d+)\s+(.+)$/.exec(line);
        return m && Number(m[2]) === process.getuid!() && path.basename(m[3]) === 'heart-portal' ? [{ pid: Number(m[1]), binary: m[3] }] : [];
      });
    } else if (this.platform === 'win32') {
      const script = windowsModulePath + `$ErrorActionPreference='Stop'; $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value;
@(@(Get-CimInstance Win32_Process -Filter "Name LIKE 'heart-portal%.exe'") | ForEach-Object {
  if ($_.ExecutablePath -and (Invoke-CimMethod -InputObject $_ -MethodName GetOwnerSid).Sid -eq $sid) { @{pid=$_.ProcessId;binary=$_.ExecutablePath} }
}) | ConvertTo-Json -Compress`;
      const output = await this.run('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')]);
      const data = output.trim() ? JSON.parse(output) : [];
      processes = Array.isArray(data) ? data : [data];
    } else return [];
    const found: Service[] = [];
    for (const process of processes) {
      let root: string, binary: string, launch: { arguments: string[]; cwd: string; environment: Record<string, string> };
      try {
        binary = await realpath(process.binary);
        const parent = path.dirname(binary);
        root = path.basename(parent) === 'release' && path.basename(path.dirname(parent)) === 'target' ? path.dirname(path.dirname(parent)) : parent;
        if (root === excludeRoot || found.some(s => s.root === root)) continue;
        if (this.platform === 'darwin') {
          await access(path.join(root, '.portal-supervisor.json'));
          launch = JSON.parse(await this.run('/usr/bin/python3', ['-c', macLaunch, String(process.pid), binary]));
        } else {
          const saved = JSON.parse(await readFile(path.join(root, '.portal-launch.json'), 'utf8'));
          launch = { arguments: saved.arguments, cwd: saved.working_directory, environment: saved.environment };
        }
        const link = launch.environment?.PORTAL_CONNECT_LINK || await readFile(path.join(root, '.portal-connection.url'), 'utf8');
        if (parseConnection(link).link !== connection.link) continue;
      } catch { continue; }
      const argument = (name: string) => { const i = launch.arguments.indexOf(name); return i >= 0 ? launch.arguments[i + 1] : launch.arguments.find(a => a.startsWith(name + '='))?.slice(name.length + 1); };
      const config = argument('--config');
      if (!config || !path.isAbsolute(launch.cwd)) throw new Error('无法保留独立 Portal 的原配置或工作目录，未停止服务。');
      const configPath = path.resolve(launch.cwd, config);
      await access(configPath);
      const status = JSON.parse(await portableCommand(binary, 'status', this.platform, this.run));
      if (this.platform === 'darwin' ? !status.portal_pids?.includes(process.pid) : Number(status.pid) !== process.pid) throw new Error('Portal 在准备升级时发生变化，请重试。');
      const environment = Object.fromEntries(Object.entries(launch.environment).filter(([key, value]) =>
        !key.startsWith('HEART_PORTAL_') && key !== 'PORTAL_CONNECT_LINK' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && typeof value === 'string' && !value.includes('\0')));
      found.push({ label, root, binary, file: '', existing: true, kind: 'portable', login: Boolean(status.launchagent_loaded),
        configPath, cwd: launch.cwd, name: argument('--name') || (await readFile(path.join(root, '.portal-name'), 'utf8')).trim(), environment });
    }
    return found;
  }
  async read(connection: Connection | null): Promise<PortalState | null> {
    if (!connection || this.platform !== 'darwin') return null;
    const listing = await this.run('/bin/ps', ['-axo', 'pid=,uid=,comm=']);
    for (const line of listing.split('\n')) {
      const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/);
      if (!match || Number(match[2]) !== process.getuid!() || path.basename(match[3]) !== 'heart-portal') continue;
      const pid = Number(match[1]);
      try {
        const binary = await realpath(match[3]);
        const parent = path.dirname(binary);
        const root = path.basename(parent) === 'release' && path.basename(path.dirname(parent)) === 'target'
          ? path.dirname(path.dirname(parent)) : parent;
        const nonce = (await readFile(path.join(root, '.portal-status-nonce'), 'utf8')
          .catch(() => readFile(path.join(root, '.portal-launch-nonce'), 'utf8'))).trim();
        if (!nonce) continue;
        const link = parseConnection(await readFile(path.join(root, '.portal-connection.url'), 'utf8'));
        if (link.link !== connection.link) continue;
        const sample = await readPortalSample(path.join(root, '.portal-connection-status.json'), pid, nonce);
        const state = portalSampleState(sample);
        return { ...state, phase: sample ? state.phase : 'external', pid, managed: false, runtimePath: root,
          message: `${state.message} 客户端仅观察，启停和自启由原管理方式负责。`, logs: [] };
      } catch { /* Incomplete, unrelated or changing runtimes are not adopted. */ }
    }
    return null;
  }
}
