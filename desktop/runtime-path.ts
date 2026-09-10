import { createHash, randomUUID } from 'node:crypto';
import { chmod, copyFile, mkdir, readFile, rename, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// Upstream accepts supervised binaries inside ~/.heart-portal. Keep each
// client profile isolated without changing HOME or the user's configuration.
export function clientRuntimeRoot(profile: string, home = os.homedir()) {
  const id = createHash('sha256').update(path.resolve(profile)).digest('hex').slice(0, 16);
  return path.join(home, '.heart-portal', 'clients', id);
}

export async function stageForegroundBinary(binary: string, profile: string, home = os.homedir()) {
  const bytes = await readFile(binary);
  const digest = (value: Buffer) => createHash('sha256').update(value).digest('hex');
  const hash = digest(bytes);
  const root = path.join(clientRuntimeRoot(profile, home), 'foreground', hash);
  const target = path.join(root, process.platform === 'win32' ? 'heart-portal.exe' : 'heart-portal');
  if (await readFile(target).then(value => digest(value) === hash, () => false)) return target;
  await mkdir(root, { recursive: true, mode: 0o700 });
  const temporary = target + '.' + randomUUID();
  try {
    await copyFile(binary, temporary);
    if (digest(await readFile(temporary)) !== hash) throw new Error('Portal changed while staging. Retry startup.');
    await chmod(temporary, 0o700);
    await rename(temporary, target);
  } finally { await rm(temporary, { force: true }); }
  return target;
}
