import path from 'node:path';
import { access } from 'node:fs/promises';

export async function desktopExecutable() {
  const executable = process.env.BEINGS_EXECUTABLE || (process.platform === 'darwin'
    ? path.resolve(`out/Beings-darwin-${process.arch}/Beings.app/Contents/MacOS/beings`)
    : path.resolve(`out/Beings-${process.platform}-${process.arch}`, process.platform === 'win32' ? 'beings.exe' : 'beings'));
  try { await access(executable); }
  catch { throw new Error(`客户端测试包不存在，请先运行 npm run package：${executable}`); }
  return executable;
}

export function backgroundCoverage() {
  if (process.env.BEINGS_TEST_BACKGROUND === '0') return { enabled: false, reason: 'BEINGS_TEST_BACKGROUND=0：当前运行环境不执行真实系统登录服务测试' };
  if (process.platform !== 'darwin') return { enabled: false, reason: '真实系统服务生命周期测试目前仅支持 macOS；Windows 守护逻辑有单元测试，仍需 Windows 实机验收' };
  return { enabled: true };
}
