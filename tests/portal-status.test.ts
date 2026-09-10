import { expect, it } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { readPortalSample } from '../desktop/portal-status';

it('rejects stale, oversized and unrelated runtime status', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'portal-status-'));
  const file = path.join(dir, 'status.json');
  const sample = { schema: 1, pid: 123, nonce: 'current-launch', boot_id: 'boot', sequence: 1, state: 'connected', updated_at_ms: Date.now() };
  try {
    await writeFile(file, JSON.stringify(sample));
    expect(await readPortalSample(file, 123, 'current-launch')).toMatchObject(sample);
    for (const patch of [{ nonce: 'old-launch' }, { pid: 456 }, { schema: 2 }, { sequence: -1 }, { updated_at_ms: Date.now() - 180_000 }, { updated_at_ms: Date.now() + 60_000 }, { state: 'pretend-connected' }]) {
      await writeFile(file, JSON.stringify({ ...sample, ...patch }));
      expect(await readPortalSample(file, 123, 'current-launch')).toBeNull();
    }
    await writeFile(file, ' '.repeat(8193));
    expect(await readPortalSample(file, 123, 'current-launch')).toBeNull();
  } finally { await rm(dir, { recursive: true, force: true }); }
});
