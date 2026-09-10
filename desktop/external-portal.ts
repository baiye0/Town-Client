import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { command, type Command } from './background';
import { parseConnection, type Connection } from './connection';
import type { PortalState } from './shared';
import { readPortalSample, portalSampleState } from './portal-status';

// Read-only discovery. Finding a process does not grant the desktop ownership of it.
export class ExternalPortalObserver {
  constructor(private run: Command = command, private platform = process.platform) {}
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
