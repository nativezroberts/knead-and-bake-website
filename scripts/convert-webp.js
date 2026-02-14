#!/usr/bin/env node

/**
 * One-time image conversion script.
 * Converts PNG/JPG images to WebP alongside the originals.
 *
 * Usage: node scripts/convert-webp.js
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '..');

const targets = [
  // Hero image: max 1200px wide, quality 80
  { dir: path.join(ROOT, 'public', 'images'), pattern: /\.(jpe?g|png)$/i, maxWidth: 1200, quality: 80 },
  // Menu card images: max 800px wide, quality 80
  { dir: path.join(ROOT, 'public', 'images', 'menu'), pattern: /\.(jpe?g|png)$/i, maxWidth: 800, quality: 80 },
  // Recipe images
  { dir: path.join(ROOT, 'public', 'images', 'recipes'), pattern: /\.(jpe?g|png)$/i, maxWidth: 800, quality: 80 },
];

async function convertFile(filePath, maxWidth, quality) {
  const ext = path.extname(filePath);
  const webpPath = filePath.replace(ext, '.webp');

  if (fs.existsSync(webpPath)) {
    console.log(`  SKIP (exists): ${path.relative(ROOT, webpPath)}`);
    return;
  }

  try {
    const image = sharp(filePath);
    const meta = await image.metadata();
    const needsResize = meta.width > maxWidth;

    let pipeline = image;
    if (needsResize) {
      pipeline = pipeline.resize({ width: maxWidth, withoutEnlargement: true });
    }

    await pipeline.webp({ quality }).toFile(webpPath);

    const origSize = fs.statSync(filePath).size;
    const webpSize = fs.statSync(webpPath).size;
    const savings = ((1 - webpSize / origSize) * 100).toFixed(0);
    console.log(`  ${path.relative(ROOT, filePath)} → .webp  (${(origSize/1024).toFixed(0)}KB → ${(webpSize/1024).toFixed(0)}KB, -${savings}%)`);
  } catch (err) {
    console.log(`  SKIP (unsupported): ${path.relative(ROOT, filePath)}`);
  }
}

async function main() {
  console.log('Converting images to WebP...\n');
  let count = 0;

  for (const { dir, pattern, maxWidth, quality } of targets) {
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir).filter(f => pattern.test(f));
    for (const file of files) {
      await convertFile(path.join(dir, file), maxWidth, quality);
      count++;
    }
  }

  console.log(`\nDone! Processed ${count} images.`);
}

main().catch(err => { console.error(err); process.exit(1); });
