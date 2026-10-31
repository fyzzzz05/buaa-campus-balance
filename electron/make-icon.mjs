import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';
import pngToIco from 'png-to-ico';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const source = path.join(root, 'desktop', 'assets', 'campus-balance-icon.svg');
const outDir = path.join(root, 'build');
const CROP = '100 100 824 824';
const SIZES = [16, 24, 32, 48, 64, 128, 256];

// Windows icons are drawn edge-to-edge; crop the 1024 viewBox to the mark and
// drop the outer drop-shadow filters so 16/32 px versions do not show a gray halo.
function sanitize(svg) {
  return svg
    .replace(/<metadata>[\s\S]*?<\/metadata>/g, '')
    .replace(/<filter\b[^>]*>[\s\S]*?<\/filter>/g, '')
    .replace(/\sfilter="url\(#[^"]+\)"/g, '')
    .replace(/viewBox="[^"]*"/, `viewBox="${CROP}"`);
}

async function render(svg, size) {
  return sharp(Buffer.from(svg), {density: 512})
    .resize(size, size, {fit: 'contain', background: {r: 0, g: 0, b: 0, alpha: 0}})
    .png({compressionLevel: 9})
    .toBuffer();
}

async function main() {
  if (!fs.existsSync(source)) throw new Error(`图标源文件缺失: ${source}`);
  const svg = sanitize(fs.readFileSync(source, 'utf8'));
  fs.mkdirSync(outDir, {recursive: true});
  const buffers = {};
  for (const size of SIZES) buffers[size] = await render(svg, size);
  fs.writeFileSync(path.join(outDir, 'icon-256.png'), buffers[256]);
  fs.writeFileSync(path.join(outDir, 'tray-16.png'), buffers[16]);
  fs.writeFileSync(path.join(outDir, 'tray-32.png'), await render(svg, 32));
  const ico = await pngToIco(SIZES.map(size => buffers[size]));
  fs.writeFileSync(path.join(outDir, 'icon.ico'), ico);
  console.log(`已生成 build/icon.ico（${SIZES.join('/')}）与托盘图标`);
}

main().catch(error => { console.error(error && error.message ? error.message : error); process.exit(1); });
