import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { TownClient, TownCredentials, townRoute } from '../desktop/town';
import type { TownQuery } from '../desktop/shared';

describe('Town reads', () => {
  it('routes only fixed resources with constrained identifiers and pagination', () => {
    expect(townRoute({ kind: 'sent' }).route).toBe('/api/messages?with=sent');
    expect(townRoute({ kind: 'scrolls', offset: 24 }).route).toContain('visibility=public&limit=24&offset=24');
    for (const query of [{ kind: 'kit', id: '../messages' }, { kind: 'kit', id: 'x?token=secret' }, { kind: 'grove', offset: -1 }, { kind: 'exec' }]) expect(() => townRoute(query as TownQuery)).toThrow();
  });
  it('uses dedicated bearer only for restricted routes, never public requests', async () => {
    const fetcher = vi.fn(async () => Response.json({ messages: [] }));
    const client = new TownClient(() => 'town-credential', fetcher as typeof fetch);
    await client.query({ kind: 'home' }); await client.query({ kind: 'inbox' });
    expect(fetcher.mock.calls[0]).toEqual(['https://beings.town/api', expect.objectContaining({ headers: { Accept: 'application/json' }, credentials: 'omit', redirect: 'error', method: 'GET' })]);
    expect(fetcher.mock.calls[1]).toEqual(['https://beings.town/api/messages?with=received', expect.objectContaining({ headers: { Accept: 'application/json', Authorization: 'Bearer town-credential' } })]);
  });
  it('distinguishes authorization failure, offline, invalid HTML and upstream error', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response('secret error text', { status: 401 })).mockRejectedValueOnce(new Error('URL with secret')).mockResolvedValueOnce(new Response('<html>loom</html>', { headers: { 'content-type': 'text/html' } })).mockResolvedValueOnce(new Response('', { status: 503 }));
    const client = new TownClient(() => '', fetcher);
    expect(await client.query({ kind: 'bonfire' })).toMatchObject({ ok: false, code: 'auth' });
    expect(await client.query({ kind: 'inbox' })).toMatchObject({ ok: false, code: 'network' });
    expect(await client.query({ kind: 'scrolls' })).toMatchObject({ ok: false, code: 'network' });
    expect(await client.query({ kind: 'home' })).toMatchObject({ ok: false, code: 'http' });
  });
  it('bounds body size and cancels an oversized stream', async () => {
    let cancelled = false;
    const response = new Response(new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(5 * 1024 * 1024)); }, cancel() { cancelled = true; } }), { headers: { 'content-type': 'application/json' } });
    const client = new TownClient(() => '', async () => response);
    expect(await client.query({ kind: 'home' })).toMatchObject({ ok: false }); expect(cancelled).toBe(true);
  });
  it('persists encrypted Town credentials independently and can clear them', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'town-test-'));
    const storage = { isEncryptionAvailable: () => true, encryptString: (s: string) => Buffer.from(s.split('').reverse().join('')), decryptString: (b: Buffer) => b.toString().split('').reverse().join('') };
    try {
      const credentials = new TownCredentials(directory, storage); await credentials.load();
      await credentials.save('town-secret-fixture-123');
      expect(await readFile(path.join(directory, 'town-credential.json'), 'utf8')).not.toContain('town-secret-fixture-123');
      const reopened = new TownCredentials(directory, storage); await reopened.load(); expect(reopened.token).toBe('town-secret-fixture-123');
      await reopened.save(''); await credentials.load(); expect(credentials.token).toBe('');
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
