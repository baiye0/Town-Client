import path from 'node:path';
import { access } from 'node:fs/promises';

export async function desktopExecutable() {
  const executable = process.env.PORTAL_DESKTOP_EXECUTABLE || (process.platform === 'darwin'
    ? path.resolve(`out/portal-desktop-darwin-${process.arch}/portal-desktop.app/Contents/MacOS/portal-desktop`)
    : path.resolve(`out/portal-desktop-${process.platform}-${process.arch}`, process.platform === 'win32' ? 'portal-desktop.exe' : 'portal-desktop'));
  try { await access(executable); }
  catch { throw new Error(`客户端测试包不存在，请先运行 npm run package：${executable}`); }
  return executable;
}

export function backgroundCoverage() {
  if (process.env.PORTAL_DESKTOP_TEST_BACKGROUND === '0') return { enabled: false, reason: 'PORTAL_DESKTOP_TEST_BACKGROUND=0：当前运行环境不执行真实系统登录服务测试' };
  if (process.platform !== 'darwin') return { enabled: false, reason: '真实系统服务生命周期测试目前仅支持 macOS；Windows 守护逻辑有单元测试，仍需 Windows 实机验收' };
  return { enabled: true };
}
