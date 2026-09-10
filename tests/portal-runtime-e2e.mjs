// Focused packaged-client test through its existing IPC API and a local relay.
// Uses a disposable profile/workspace; never contacts a real Being.
import { _electron as electron } from 'playwright';
import { WebSocketServer } from 'ws';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { desktopExecutable } from './support/desktop.mjs';

const temporary = await mkdtemp(path.join(os.tmpdir(), 'portal-runtime-e2e-'));
const token = 'local-runtime-fixture';
const server = createServer((_request, response) => {
  response.writeHead(200, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify({ being_name: 'fixture', messages: [] }));
});
const wss = new WebSocketServer({ server, path: '/_relay' });
let relay, handshakes = 0, nextId = 0, app;
const pending = new Map();
wss.on('connection', socket => {
  let ready = false;
  socket.on('message', bytes => {
    const message = JSON.parse(bytes.toString());
    if (!ready) {
      assert.equal(message.loom_token, token);
      assert.equal(message.being_id, 'fixture');
      ready = true; relay = socket; handshakes++;
      socket.send(JSON.stringify({ ok: true, relay_keepalive: 'text-v1' })); return;
    }
    if (message.type === 'keepalive') { socket.send(JSON.stringify({ type: 'keepalive_ack' })); return; }
    const request = pending.get(message.id);
    if (request) {
      clearTimeout(request.timer); pending.delete(message.id);
      message.error ? request.reject(new Error(JSON.stringify(message.error))) : request.resolve(message.result);
    }
  });
});
const rpc = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++nextId;
  const timer = setTimeout(() => { pending.delete(id); reject(new Error('Local MCP request timed out')); }, 10_000);
  pending.set(id, { resolve, reject, timer });
  relay.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
});
const until = async predicate => {
  const deadline = Date.now() + 20_000;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error('Runtime state did not converge');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
};
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  app = await electron.launch({ executablePath: await desktopExecutable(), env: { ...process.env, BEINGS_USER_DATA: path.join(temporary, 'profile') } });
  const page = await app.firstWindow();
  await page.waitForFunction(() => Boolean(window.beings));
  await page.evaluate(async input => {
    const { settings } = await window.beings.snapshot();
    await window.beings.save({ ...settings, ...input, portalName: 'runtime-fixture', allowExec: false, kitsEnabled: false, autoStart: false, backgroundEnabled: false });
    await window.beings.startPortal();
  }, { connectionLink: `http://127.0.0.1:${server.address().port}/fixture/?token=${token}`, workspace: path.join(temporary, '中文 workspace') });
  const state = async () => (await page.evaluate(() => window.beings.snapshot())).portal;
  await until(async () => (await state()).phase === 'connected');
  const pid = (await state()).pid;
  assert(Number.isInteger(pid));
  const result = await rpc('tools/call', { name: 'portal_file_write', arguments: { path: 'result.txt', content: '本地运行成功' } });
  assert.notEqual(result.isError, true);
  assert.equal(await readFile(path.join(temporary, '中文 workspace/result.txt'), 'utf8'), '本地运行成功');
  assert.equal((await rpc('tools/call', { name: 'portal_exec', arguments: { command: 'echo must-not-run' } })).isError, true);
  assert.equal((await rpc('tools/call', { name: 'portal_file_read', arguments: { path: '../outside' } })).isError, true);
  relay.terminate();
  await until(() => handshakes >= 2);
  await until(async () => (await state()).phase === 'connected');
  assert.equal((await state()).pid, pid, 'network reconnect must not restart Portal');
  await rpc('ping');
  await page.evaluate(() => window.beings.stopPortal());
  assert.equal((await state()).phase, 'stopped');
  console.log('PASS: packaged client structured status, confined file write, disabled execution, reconnect without restart, owned stop');
} finally {
  if (app) await app.close().catch(() => {});
  for (const request of pending.values()) clearTimeout(request.timer);
  for (const client of wss.clients) client.terminate();
  wss.close(); server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await rm(temporary, { recursive: true, force: true });
}
