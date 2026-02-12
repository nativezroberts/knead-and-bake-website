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

// 3. Copy CSS
copyDir(path.join(ROOT, 'src', 'css'), path.join(DIST, 'src', 'css'));
console.log('  Copied CSS');

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
    fs.copyFileSync(recipeTemplate, path.join(DIST, 'recipes', `${recipe.slug}.html`));
  }
  console.log(`  Generated ${recipesData.recipes.length} recipe detail pages`);
}

// 8. Clean up templates (recipe-detail shouldn't be accessible at root; news-detail stays as a routable page)
try { fs.unlinkSync(path.join(DIST, 'recipe-detail.html')); } catch {}

// 9. Generate sitemap.xml
const siteUrl = 'https://kneadandbaketx.com';
const staticPages = [
  '', 'about', 'menu', 'preorder', 'recipes', 'starter-kit', 'news', 'news-detail', 'social', 'market'
];
const sitemapEntries = [
  ...staticPages.map(p => `  <url><loc>${siteUrl}/${p ? p + '.html' : ''}</loc><changefreq>weekly</changefreq></url>`),
  ...recipesData.recipes.map(r => `  <url><loc>${siteUrl}/recipes/${r.slug}.html</loc><changefreq>monthly</changefreq></url>`),
];
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapEntries.join('\n')}
</urlset>`;
fs.writeFileSync(path.join(DIST, 'sitemap.xml'), sitemap);
console.log('  Generated sitemap.xml');

// 10. Copy robots.txt
const robotsTxt = `User-agent: *
Allow: /

Sitemap: ${siteUrl}/sitemap.xml`;
fs.writeFileSync(path.join(DIST, 'robots.txt'), robotsTxt);
console.log('  Generated robots.txt');

console.log('\nBuild complete! Output: /dist');
console.log(`  ${fs.readdirSync(DIST).length} top-level files/dirs`);
