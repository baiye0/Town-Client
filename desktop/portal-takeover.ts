import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { atomic } from './background';
import { portalIdentity, type PortalConflict } from './external-portal';
import { redact, type Connection } from './connection';

interface Decision { schema: 1; identity: string; phase: 'cancelled' | 'stopping' | 'starting' | 'blocked'; message: string; replacing?: boolean }
interface TakeoverOptions {
  discover(connection: Connection): Promise<PortalConflict[]>;
  confirm(targets: PortalConflict[]): Promise<boolean>;
  stop(target: PortalConflict): Promise<void>;
  preflight(): Promise<void>;
}
/** One explicit transaction per user action. No timer, retry, or old-service
 * resurrection; persisted decisions also stop automatic retries after a crash. */
export class PortalTakeover {
  readonly file: string;
  holdMessage = '';
  constructor(directory: string, private options: TakeoverOptions) { this.file = path.join(directory, 'portal-takeover.json'); }
  async run(connection: Connection, intent: 'manual' | 'automatic', start: (replacing: boolean) => Promise<void>, requireConflict = false): Promise<boolean> {
    const identity = portalIdentity(connection);
    let saved: Decision | undefined;
    try { saved = JSON.parse(await readFile(this.file, 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Portal 切换记录无法读取，请保留记录并检查后重试。'); }
    if (saved && (saved.schema !== 1 || !['cancelled', 'stopping', 'starting', 'blocked'].includes(saved.phase))) throw new Error('Portal 切换记录无效，已暂停自动启动。');
    if (intent === 'automatic' && saved?.identity === identity) {
      this.holdMessage = saved.message || '上次 Portal 切换未完成，请点击启动按钮重新确认。';
      return false;
    }
    this.holdMessage = '';
    let changing = saved?.identity === identity && saved.replacing === true;
    const remember = async (phase: Decision['phase'], message: string) => {
      this.holdMessage = message;
      await atomic(this.file, JSON.stringify({ schema: 1, identity, phase, message, replacing: changing } satisfies Decision));
    };
    try {
      const targets = await this.options.discover(connection);
      if (!targets.length && requireConflict) throw new Error('检测到实例冲突，但无法确认旧守护程序。已停止自动重试，请检查旧 Portal 后手动启动。');
      if (targets.some(item => !item.service)) {
        throw new Error(targets.filter(item => !item.service).map(item => `${item.root}：${item.problem}`).join('\n'));
      }
      if (targets.length) {
        // Make the chosen replacement reviewable and validate it before asking.
        await this.options.preflight();
        if (!await this.options.confirm(targets)) {
          await remember('cancelled', '已取消切换，保留旧 Portal。需要切换时点击「使用客户端 Portal」重新确认；不会自动重试或反复弹窗。');
          return false;
        }
        const current = await this.options.discover(connection);
        if (current.some(item => !item.service || !targets.some(approved => approved.id === item.id))) throw new Error('旧 Portal 或守护配置在确认期间发生变化，未执行接管，请重新确认。');
        changing = true;
        await remember('stopping', '上次关闭旧 Portal 的过程未完成，已暂停自动启动，请手动重试。');
        for (const target of current) await this.options.stop(target);
        if ((await this.options.discover(connection)).length) throw new Error('旧 Portal 或守护程序尚未完全停止，未启动新实例。');
        await remember('starting', '上次启动客户端 Portal 的过程未完成，已暂停自动启动，请手动重试。');
      }
      await start(changing);
      await rm(this.file, { force: true });
      this.holdMessage = '';
      return true;
    } catch (error) {
      const message = redact((error as Error).message || String(error), [connection.token, connection.relaySecret]);
      await remember('blocked', `${message}\n已暂停自动切换和重试，请处理后点击启动按钮。`);
      throw new Error(this.holdMessage);
    }
  }
}
