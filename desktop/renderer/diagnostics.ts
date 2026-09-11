import type { DesktopAPI } from '../shared';
export function mountDiagnostics(api: DesktopAPI, report: (error: unknown) => void) {
  const dialog = document.getElementById('diagnostics-dialog') as HTMLDialogElement;
  const list = document.getElementById('diagnostics-checks')!;
  const refresh = document.getElementById('diagnostics-refresh') as HTMLButtonElement;
  const run = async () => {
    refresh.disabled = true; list.textContent = '正在检查连接与本机状态…';
    try {
      const state = await api.diagnostics(); if (!dialog.open) return;
      document.getElementById('diagnostics-version')!.textContent = `portal-desktop ${state.version} · ${state.platform}\n构建 ${state.build}\n主进程 ${state.pid} · 启动 ${new Date(state.startedAt).toLocaleString()}`;
      list.replaceChildren();
      for (const check of state.checks) {
        const row = document.createElement('div'); row.className = 'diagnostic-row'; row.dataset.status = check.status;
        const name = document.createElement('strong'); name.textContent = `${check.status === 'ok' ? '✓' : check.status === 'error' ? '×' : '·'} ${check.name}`;
        const detail = document.createElement('span'); detail.textContent = check.detail; row.append(name, detail); list.append(row);
      }
    } catch (error) { list.textContent = '检查未完成，请重试。'; report(error); }
    finally { refresh.disabled = false; }
  };
  document.getElementById('open-diagnostics')!.onclick = () => { dialog.showModal(); void run(); };
  document.getElementById('diagnostics-close')!.onclick = () => dialog.close();
  refresh.onclick = () => void run();
  const exportButton = document.getElementById('diagnostics-export') as HTMLButtonElement;
  exportButton.onclick = async () => { exportButton.disabled = true; try { if (await api.exportDiagnostics()) report('已导出诊断，不含聊天内容或连接凭据。'); } catch (error) { report(error); } finally { exportButton.disabled = false; } };
}
