import { expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { SettingsStore } from '../desktop/settings';

it('persists credentials encrypted, reloads and preserves them on workspace-only changes', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'beings-settings-'));
  const key = randomBytes(32);
  const storage = {
    isEncryptionAvailable: () => true,
    encryptString: (text: string) => { const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key, iv); return Buffer.concat([iv, cipher.update(text), cipher.final(), cipher.getAuthTag()]); },
    decryptString: (data: Buffer) => { const cipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12)); cipher.setAuthTag(data.subarray(-16)); return Buffer.concat([cipher.update(data.subarray(12, -16)), cipher.final()]).toString(); },
  };
  try {
    const store = new SettingsStore(dir, storage, process.execPath);
    await store.load(); expect(store.connection).toBeNull();
    await store.save({ ...store.settings, workspace: path.join(dir, '中文 workspace'), connectionLink: 'https://echo.example/alice/?token=private-test-credential&secret=relay-secret' });
    expect(JSON.stringify(store.settings)).not.toContain('private-test-credential');
    const disk = await readFile(path.join(dir, 'connection.json'), 'utf8');
    expect(disk).not.toContain('private-test-credential'); expect(disk).not.toContain('relay-secret');
    const reopened = new SettingsStore(dir, storage, process.execPath); await reopened.load();
    expect(reopened.connection?.relaySecret).toBe('relay-secret');
    await reopened.save({ ...reopened.settings, portalName: 'new-name' });
    expect(reopened.connection?.token).toBe('private-test-credential');
    const unavailable = new SettingsStore(dir, { ...storage, isEncryptionAvailable: () => false }, process.execPath);
    await expect(unavailable.save({ ...store.settings, connectionLink: 'https://echo.example/alice/?token=test' })).rejects.toThrow('密钥库');
    await expect(store.save({ ...store.settings, portalName: 'bad\nname' })).rejects.toThrow();
    await expect(store.save({ ...store.settings, workspace: '../outside' })).rejects.toThrow();
  } finally { await rm(dir, { recursive: true, force: true }); }
});
