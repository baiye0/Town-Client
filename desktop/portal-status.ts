import { open } from 'node:fs/promises';
import type { PortalState } from './shared';

export interface PortalSample {
  schema: 1; pid: number; nonce: string; boot_id: string; sequence: number;
  state: string; updated_at_ms: number;
}
// Telemetry from the selected runtime only; never grants ownership or permissions.
export async function readPortalSample(file: string, pid: number, nonce: string): Promise<PortalSample | null> {
  try {
    const handle = await open(file, 'r');
    let bytes: Buffer;
    try {
      bytes = Buffer.alloc(8193);
      const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
      if (bytesRead > 8192) return null;
      bytes = bytes.subarray(0, bytesRead);
    } finally { await handle.close(); }
    const s = JSON.parse(bytes.toString());
    const now = Date.now();
    if (s.schema !== 1 || s.pid !== pid || !nonce || s.nonce !== nonce ||
        typeof s.boot_id !== 'string' || !s.boot_id || !Number.isSafeInteger(s.sequence) || s.sequence < 1 ||
        !Number.isSafeInteger(s.updated_at_ms) || s.updated_at_ms > now + 5000 || now - s.updated_at_ms > 120_000 ||
        !['starting', 'connecting', 'connected', 'retrying', 'auth_required', 'invalid', 'local'].includes(s.state)) return null;
    return s;
  } catch { return null; }
}

export function portalSampleState(sample: PortalSample | null): Pick<PortalState, 'phase' | 'message'> {
  if (!sample) return { phase: 'starting', message: 'Portal 进程正在运行，等待有效连接状态；旧版 Portal 不提供此状态。' };
  switch (sample.state) {
    case 'connected': return { phase: 'connected', message: 'Portal 已连接云端 Being，等待工具调用' };
    case 'retrying': return { phase: 'reconnecting', message: 'Relay 连接断开，Portal 正在自动重连' };
    case 'auth_required': return { phase: 'error', message: '连接凭据已失效或被拒绝，请更新 Being 连接链接。' };
    case 'invalid': return { phase: 'error', message: 'Portal 连接配置无效，请检查连接链接。' };
    default: return { phase: 'starting', message: sample.state === 'local' ? 'Portal 本地服务已就绪' : 'Portal 正在连接…' };
  }
}
