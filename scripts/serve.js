#!/usr/bin/env node

/**
 * Local dev server — serves the site from project root with live-reload-like behavior.
 * No dependencies required (uses Node.js built-in http module).
 *
 * Usage: node scripts/serve.js [port]
 * Default port: 3000
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = parseInt(process.argv[2]) || 3000;

// Serve from project root for development (not /dist)
// This means paths like /src/css/main.css and /content/menu.json work directly
const ROOT = path.resolve(__dirname, '..');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.mjs':  'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif':  'image/gif',
  '.ico':  'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.pdf':  'application/pdf',
  '.xml':  'application/xml',
  '.txt':  'text/plain; charset=utf-8',
};

function resolveFilePath(urlPath) {
  // Map URL paths to file system paths
  // Pages are in /src/pages/ but served at root
  let filePath;

  if (urlPath === '/' || urlPath === '/index.html') {
    filePath = path.join(ROOT, 'src', 'pages', 'index.html');
  } else if (urlPath.startsWith('/src/') || urlPath.startsWith('/content/') || urlPath.startsWith('/images/') || urlPath.startsWith('/downloads/') || urlPath.startsWith('/fonts/')) {
    // Serve directly from project root
    filePath = path.join(ROOT, urlPath);

    // For /images/ and /downloads/, also check public/
    if (!fs.existsSync(filePath) && (urlPath.startsWith('/images/') || urlPath.startsWith('/downloads/') || urlPath.startsWith('/fonts/'))) {
      filePath = path.join(ROOT, 'public', urlPath);
    }
  } else if (urlPath.startsWith('/recipes/') && urlPath.endsWith('.html')) {
    // Recipe detail pages
    filePath = path.join(ROOT, 'src', 'pages', 'recipe-detail.html');
  } else if (urlPath.startsWith('/news/') && urlPath.endsWith('.html')) {
    // News detail pages
    filePath = path.join(ROOT, 'src', 'pages', 'news-detail.html');
  } else {
    // Try as a page in /src/pages/
    let pagePath = urlPath;
    if (!pagePath.endsWith('.html')) pagePath += '.html';
    filePath = path.join(ROOT, 'src', 'pages', pagePath);
  }

  return filePath;
}

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  const filePath = resolveFilePath(urlPath);

  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<h1>404 — Not Found</h1><p><a href="/">Go home</a></p>');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  // No caching in dev
  res.writeHead(200, {
    'Content-Type': contentType,
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Access-Control-Allow-Origin': '*',
  });

  fs.createReadStream(filePath).pipe(res);
});

server.listen(PORT, () => {
  console.log(`\n  Knead & Bake TX — Dev Server`);
  console.log(`  http://localhost:${PORT}\n`);
  console.log(`  Pages:    /src/pages/*.html → served at root`);
  console.log(`  Content:  /content/*.json → served directly`);
  console.log(`  Assets:   /public/* → served at root\n`);
});
