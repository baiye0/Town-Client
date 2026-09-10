import { writeRuntimeBundle } from './runtime-bundle.mjs';
import { mkdir, readFile, writeFile, copyFile, access, chmod } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';
import { portalSource } from './portal-source.mjs';

const output = path.resolve('desktop/generated');
await mkdir(output, { recursive: true });
let html = await readFile('loom.html', 'utf8');
function replaceOnce(pattern, replacement) {
  if (!pattern.test(html)) throw new Error(`Loom source changed; update desktop adapter: ${pattern}`);
  html = html.replace(pattern, replacement);
}
html = html.replace(/<link rel="preconnect"[^>]+>\n/g, '');
replaceOnce(/<script defer src="https:\/\/cdn\.jsdelivr\.net[\s\S]*?<link rel="stylesheet"[^>]+>/,
  '<script defer src="/vendor.js"></script>\n<link rel="stylesheet" href="/highlight.css">\n<link rel="stylesheet" href="/chat.css">');
replaceOnce(/const API_URL = [^\n]+;/, "const API_URL = 'beings://chat';");
replaceOnce(/const LOOM_TOKEN = [^\n]+;/, "const LOOM_TOKEN = '';");
replaceOnce(/const RELAY_SECRET = [^\n]+;/, "const RELAY_SECRET = '';");
replaceOnce(/\$input\.placeholder = `message \$\{beingName\}\.\.\.`;/, "$input.placeholder = '说点什么…';");
replaceOnce(/return marked\.parse\(text\);/, "return DOMPurify.sanitize(marked.parse(text), { ADD_ATTR: ['target'] });");
replaceOnce(/<!-- attach button removed -->/, '<button class="btn-icon" onclick="document.getElementById(\'file-input\').click()" title="添加附件" aria-label="添加附件">＋</button>');
// Icon-only close controls retain meaningful names after desktop styling.
for (const [handler, label] of [['toggleSoulCard', '关闭 Being 信息'], ['togglePrivacy', '关闭隐私说明'], ['toggleSettings', '关闭模型设置']]) {
  replaceOnce(new RegExp(`<button class="btn-close" onclick="${handler}\\(\\)"`), `<button class="btn-close" type="button" aria-label="${label}" onclick="${handler}()"`);
}
// Parent receives status and bounded search summaries; no credentials or desktop IPC are exposed to this frame.
replaceOnce(/connState = next;/, "connState = next;\n  parent.postMessage({ type: 'beings:connection', state: next }, '*');");
replaceOnce(/connState = 'online';\s*\/\//, "connState = 'online';\n  parent.postMessage({ type: 'beings:connection', state: 'online' }, '*'); //");
// Rebuild the chat layout while preserving Loom's protocol, history and tool handling.
replaceOnce(/<head>/, `<head><script>
  document.documentElement.dataset.theme = new URLSearchParams(location.search).get('theme') === 'dark' ? 'dark' : 'light';
  window.addEventListener('message', event => {
    if (event.source === parent && event.data?.type === 'beings:appearance' && ['light','dark'].includes(event.data.theme)) document.documentElement.dataset.theme = event.data.theme;
  });
</script>`);
replaceOnce(/<button class="btn-icon" id="send-btn"/, `<div id="desktop-composer-tools">
</div><button class="btn-icon" id="send-btn"`);
// Notify the desktop presentation after the existing stream handler finishes its synchronous work.
for (const name of ['tuiSet', 'tuiClear', 'renderActivityLog', 'finalizeSendCleanup', 'setTuiHint']) {
  replaceOnce(new RegExp(`function ${name}\\(([^)]*)\\) \\{`), `$&\n  window.dispatchEvent(new CustomEvent('beings:activity'));`);
}
replaceOnce(/function tuiDone\(\) \{/, "$&\n  window.dispatchEvent(new CustomEvent('beings:activity', { detail: 'done' }));");
replaceOnce(/<\/body>/, '<script src="/chat-index.js"></script><script src="/chat-activity.js"></script><script src="/chat-scene.js"></script></body>');
await build({ entryPoints: ['desktop/renderer/chat-index.ts'], bundle: true, format: 'iife', platform: 'browser', outfile: path.join(output, 'chat-index.js') });
await build({ entryPoints: ['desktop/renderer/chat-activity.ts'], bundle: true, format: 'iife', platform: 'browser', outfile: path.join(output, 'chat-activity.js') });
await build({ entryPoints: ['desktop/renderer/chat-scene.ts'], bundle: true, format: 'iife', platform: 'browser', outfile: path.join(output, 'chat-scene.js') });
await writeFile(path.join(output, 'loom.html'), html);
await build({ stdin: { contents: `import { marked } from 'marked'; import hljs from 'highlight.js'; import DOMPurify from 'dompurify'; Object.assign(window, { marked, hljs, DOMPurify });`, resolveDir: process.cwd() },
  bundle: true, format: 'iife', platform: 'browser', minify: true, outfile: path.join(output, 'vendor.js') });
await copyFile('node_modules/highlight.js/styles/github-dark.min.css', path.join(output, 'highlight.css'));
await copyFile('desktop/renderer/chat.css', path.join(output, 'chat.css'));
const notices = [];
for (const [name, file] of [['marked', 'LICENSE.md'], ['highlight.js', 'LICENSE'], ['dompurify', 'LICENSE']]) {
  notices.push(`${name}\n${await readFile(path.join('node_modules', name, file), 'utf8')}`);
}
await writeFile(path.join(output, 'THIRD-PARTY-LICENSES.txt'), notices.join('\n\n---\n\n'));
const binaryName = process.platform === 'win32' ? 'heart-portal.exe' : 'heart-portal';
const destination = path.resolve('resources', binaryName);
await mkdir('resources', { recursive: true });
try { await access(destination); }
catch {
  const source = path.join(portalSource, 'target/release', binaryName);
  try { await copyFile(source, destination); if (process.platform !== 'win32') await chmod(destination, 0o755); }
  catch { console.log('Portal binary not found. Chat is available; run npm run build:portal to bundle the local engine.'); }
}
try { await access(destination); await writeRuntimeBundle(); } catch (error) { if (error.code !== 'ENOENT') throw error; }
console.log('Prepared local Loom assets (no CDN requests).');
