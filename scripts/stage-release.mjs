import { createHash } from 'node:crypto';
import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const [input, output, version] = process.argv.slice(2);
if (!input || !output || !/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Usage: stage-release.mjs artifacts output X.Y.Z');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function files(root) {
  const result = [];
  for (const item of await readdir(root, { withFileTypes: true })) {
    const file = path.join(root, item.name);
    result.push(...(item.isDirectory() ? await files(file) : [file]));
  }
  return result;
}
function exactlyOne(items, label) {
  if (items.length !== 1) throw new Error(`Expected exactly one ${label}, got ${items.length}`);
  return items[0];
}
await mkdir(output, { recursive: true });
for (const [artifact, platform, arch, label] of [
  ['Town-Client-macos-14', 'darwin', 'arm64', 'macos-arm64'],
  ['Town-Client-windows-latest', 'win32', 'x64', 'windows-x64'],
]) {
  const contents = await files(path.join(input, artifact));
  const metadata = exactlyOne(contents.filter(f => path.basename(f) === 'runtime-bundle.json'), 'runtime manifest');
  const bundle = JSON.parse(await readFile(metadata, 'utf8'));
  if (bundle.schema !== 1 || bundle.clientVersion !== version || bundle.platform !== platform || bundle.arch !== arch) throw new Error(`Mismatched ${label} manifest`);
  const zip = exactlyOne(contents.filter(f => f.endsWith('.zip')), 'platform ZIP');
  const entries = execFileSync('unzip', ['-Z1', zip], { encoding: 'utf8' }).split('\n');
  const embedded = exactlyOne(entries.filter(f => /(?:^|\/)[Rr]esources\/runtime-bundle\.json$/.test(f)), 'packaged runtime manifest');
  if (!execFileSync('unzip', ['-p', zip, embedded]).equals(await readFile(metadata))) throw new Error(`${label} packaged manifest mismatch`);
  const binary = exactlyOne(entries.filter(f => platform === 'darwin'
    ? f.endsWith('.app/Contents/Resources/heart-portal') : /(?:^|\/)resources\/heart-portal\.exe$/.test(f)), 'bundled engine');
  if (sha(execFileSync('unzip', ['-p', zip, binary], { maxBuffer: 256 * 1024 * 1024 })) !== bundle.sha256) throw new Error(`${label} engine checksum mismatch`);
  await copyFile(zip, path.join(output, `Town-Client-${version}-${label}.zip`));
  await copyFile(metadata, path.join(output, `runtime-bundle-${label}.json`));
  if (platform === 'win32') {
    const setup = exactlyOne(contents.filter(f => /setup\.exe$/i.test(f)), 'Windows Setup');
    await copyFile(setup, path.join(output, `Town-Client-${version}-${label}-Setup.exe`));
  }
}
const sums = [];
for (const name of (await readdir(output)).sort()) sums.push(`${sha(await readFile(path.join(output, name)))}  ${name}`);
await writeFile(path.join(output, 'SHA256SUMS.txt'), sums.join('\n') + '\n');
console.log(`Validated and staged ${sums.length} release assets for ${version}.`);
