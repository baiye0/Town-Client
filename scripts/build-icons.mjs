// Format conversion only: keep the supplied artwork, background and proportions.
// Run on macOS after replacing resources/branding/logo.png. Outputs are committed
// so Windows/Linux builds do not require Apple's icon conversion tools.
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'darwin') throw new Error('Icon generation requires macOS sips and iconutil. Use the committed icons on other platforms.');
const branding = fileURLToPath(new URL('../resources/branding/', import.meta.url));
const source = path.join(branding, 'logo.png');
const temporary = await mkdtemp(path.join(os.tmpdir(), 'town-icons-'));
const resize = (size, output) => execFileSync('sips', ['-z', String(size), String(size), source, '--out', output], { stdio: 'ignore' });
try {
  const iconset = path.join(temporary, 'app.iconset');
  await mkdir(iconset);
  for (const size of [16, 32, 128, 256, 512]) {
    resize(size, path.join(iconset, `icon_${size}x${size}.png`));
    resize(size * 2, path.join(iconset, `icon_${size}x${size}@2x.png`));
  }
  execFileSync('iconutil', ['-c', 'icns', iconset, '-o', path.join(branding, 'app.icns')]);
  resize(512, path.join(branding, 'app.png'));

  // ICO supports PNG frames; include small sizes for Windows shell/taskbar use.
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const header = Buffer.alloc(6 + sizes.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  const frames = [];
  let offset = header.length;
  for (const [index, size] of sizes.entries()) {
    const frame = path.join(temporary, `${size}.png`);
    resize(size, frame);
    const png = await readFile(frame);
    const entry = 6 + index * 16;
    header[entry] = header[entry + 1] = size === 256 ? 0 : size;
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(png.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    frames.push(png);
    offset += png.length;
  }
  await writeFile(path.join(branding, 'app.ico'), Buffer.concat([header, ...frames]));
  console.log('Generated app.png, app.icns and app.ico from the supplied logo.');
} finally {
  await rm(temporary, { recursive: true, force: true });
}
