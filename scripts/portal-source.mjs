import { access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const portalSource = path.resolve(process.env.HEART_PORTAL_SOURCE || fileURLToPath(new URL('../heart-portal', import.meta.url)));

export async function requirePortalSource() {
  try {
    await access(path.join(portalSource, 'Cargo.toml'));
  } catch {
    throw new Error(process.env.HEART_PORTAL_SOURCE
      ? `Portal source missing at ${portalSource}. Check HEART_PORTAL_SOURCE.`
      : 'Portal source missing from heart-portal/. Run git submodule update --init --recursive, or set HEART_PORTAL_SOURCE.');
  }
  return portalSource;
}
