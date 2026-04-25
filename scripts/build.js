#!/usr/bin/env node

/**
 * Build script — copies all static files into /dist for deployment.
 * No bundler needed: this is a vanilla static site.
 *
 * Usage: node scripts/build.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

// Directories to clean
function cleanDist() {
  if (fs.existsSync(DIST)) {
    fs.rmSync(DIST, { recursive: true });
  }
  fs.mkdirSync(DIST, { recursive: true });
}

// Recursively copy a directory
function copyDir(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// Copy a single file
function copyFile(src, dest) {
  if (!fs.existsSync(src)) return;
  const destDir = path.dirname(dest);
  fs.mkdirSync(destDir, { recursive: true });
  fs.copyFileSync(src, dest);
}

console.log('Building Knead & Bake TX site...\n');

// 1. Clean dist
cleanDist();
console.log('  Cleaned /dist');

// 2. Copy HTML pages from /src/pages to /dist root
const pagesDir = path.join(ROOT, 'src', 'pages');
for (const file of fs.readdirSync(pagesDir)) {
  if (file.endsWith('.html')) {
    fs.copyFileSync(path.join(pagesDir, file), path.join(DIST, file));
  }
}
console.log('  Copied HTML pages');

// 3. Concatenate CSS into a single main.css (eliminates @import chain at runtime)
const cssDir = path.join(ROOT, 'src', 'css');
const cssOrder = ['variables.css', 'reset.css', 'layout.css', 'components.css', 'pages.css'];
const concatenatedCss = cssOrder
  .map(f => fs.readFileSync(path.join(cssDir, f), 'utf-8'))
  .join('\n');
const distCssDir = path.join(DIST, 'src', 'css');
fs.mkdirSync(distCssDir, { recursive: true });
fs.writeFileSync(path.join(distCssDir, 'main.css'), concatenatedCss);
console.log('  Concatenated CSS into single main.css');

// 4. Copy JS
copyDir(path.join(ROOT, 'src', 'js'), path.join(DIST, 'src', 'js'));
console.log('  Copied JS');

// 5. Copy content (JSON data)
copyDir(path.join(ROOT, 'content'), path.join(DIST, 'content'));
console.log('  Copied content data');

// 6. Copy public assets (images, fonts, downloads)
copyDir(path.join(ROOT, 'public'), path.join(DIST));
console.log('  Copied public assets');

// 7. Generate recipe and news detail pages by copying the template
// Recipe details
const recipesData = JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'recipes.json'), 'utf-8'));
const recipeTemplate = path.join(DIST, 'recipe-detail.html');
if (fs.existsSync(recipeTemplate)) {
  fs.mkdirSync(path.join(DIST, 'recipes'), { recursive: true });
  for (const recipe of recipesData.recipes) {
    if (!/^[a-z0-9-]+$/.test(recipe.slug)) {
      throw new Error(`Invalid recipe slug: "${recipe.slug}" — only lowercase letters, numbers, hyphens allowed`);
    }
    fs.copyFileSync(recipeTemplate, path.join(DIST, 'recipes', `${recipe.slug}.html`));
  }
  console.log(`  Generated ${recipesData.recipes.length} recipe detail pages`);
}

// 8. Clean up templates (recipe-detail shouldn't be accessible at root; news-detail stays as a routable page)
try { fs.unlinkSync(path.join(DIST, 'recipe-detail.html')); } catch {}

// 9. Generate sitemap.xml
const siteUrl = 'https://kneadandbaketx.com';
const today = new Date().toISOString().split('T')[0];
const sitemapPages = [
  { path: '',             priority: '1.0', freq: 'weekly'  },
  { path: 'menu',         priority: '0.9', freq: 'weekly'  },
  { path: 'market',       priority: '0.9', freq: 'weekly'  },
  { path: 'about',        priority: '0.7', freq: 'monthly' },
  { path: 'recipes',      priority: '0.8', freq: 'monthly' },
  { path: 'starter-kit',  priority: '0.7', freq: 'monthly' },
  { path: 'news',         priority: '0.8', freq: 'weekly'  },
  { path: 'social',       priority: '0.5', freq: 'monthly' },
];
const sitemapEntries = [
  ...sitemapPages.map(p => [
    `  <url>`,
    `    <loc>${siteUrl}/${p.path ? p.path + '.html' : ''}</loc>`,
    `    <lastmod>${today}</lastmod>`,
    `    <changefreq>${p.freq}</changefreq>`,
    `    <priority>${p.priority}</priority>`,
    `  </url>`,
  ].join('\n')),
  ...recipesData.recipes.map(r => [
    `  <url>`,
    `    <loc>${siteUrl}/recipes/${r.slug}.html</loc>`,
    `    <lastmod>${today}</lastmod>`,
    `    <changefreq>monthly</changefreq>`,
    `    <priority>0.6</priority>`,
    `  </url>`,
  ].join('\n')),
];
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapEntries.join('\n')}
</urlset>`;
fs.writeFileSync(path.join(DIST, 'sitemap.xml'), sitemap);
console.log('  Generated sitemap.xml');

// 10. Generate robots.txt
const robotsTxt = `User-agent: *
Allow: /
Disallow: /admin.html
Disallow: /preorder.html

Sitemap: ${siteUrl}/sitemap.xml`;
fs.writeFileSync(path.join(DIST, 'robots.txt'), robotsTxt);
console.log('  Generated robots.txt');

// 11. Minify CSS and JS with esbuild
const esbuild = require('esbuild');

function getFilesRecursive(dir, ext) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...getFilesRecursive(fullPath, ext));
    } else if (entry.name.endsWith(ext)) {
      results.push(fullPath);
    }
  }
  return results;
}

const cssFiles = getFilesRecursive(path.join(DIST, 'src', 'css'), '.css');
const jsFiles = getFilesRecursive(path.join(DIST, 'src', 'js'), '.js');

let totalSaved = 0;
for (const file of [...cssFiles, ...jsFiles]) {
  const original = fs.readFileSync(file, 'utf-8');
  const loader = file.endsWith('.css') ? 'css' : 'js';
  const { code } = esbuild.transformSync(original, { minify: true, loader });
  fs.writeFileSync(file, code);
  const saved = original.length - code.length;
  totalSaved += saved;
}
console.log(`  Minified ${cssFiles.length} CSS + ${jsFiles.length} JS files (saved ~${(totalSaved / 1024).toFixed(1)} KB)`);

console.log('\nBuild complete! Output: /dist');
console.log(`  ${fs.readdirSync(DIST).length} top-level files/dirs`);
