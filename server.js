// Profit Lab — web server (first slice: public site + live demo)
// Zero dependencies by design: portable Node, runs anywhere.
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 4700;
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
};

const ROUTES = {
  '/': 'index.html',
  '/demo': 'demo.html',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let pathname = url.pathname;

  if (pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, service: 'profit-lab' }));
    return;
  }

  const mapped = ROUTES[pathname] || pathname.slice(1);
  const filePath = path.join(PUBLIC_DIR, mapped);

  // Never serve outside public/
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<h1 style="font-family:sans-serif">404 — page not found. <a href="/">Profit Lab home</a></h1>');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`Profit Lab listening on port ${PORT}`);
});
