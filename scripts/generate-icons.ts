import sharp from 'sharp';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const svgPath = join(__dirname, '..', 'public', 'icons', 'icon-512.svg');
const outDir = join(__dirname, '..', 'public', 'icons');

const svg = readFileSync(svgPath);

await sharp(svg).resize(192, 192).png().toFile(join(outDir, 'icon-192.png'));
console.log('✅ icon-192.png generated');

await sharp(svg).resize(512, 512).png().toFile(join(outDir, 'icon-512.png'));
console.log('✅ icon-512.png generated');
