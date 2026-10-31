'use strict';
// Local HTTP server shared by the browser dev mode (`dev.js`) and the Electron
// app. It serves the two pages from public/ and forwards /api/* to the existing
// handlers, with the same transport hardening as the native macOS app.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const auth = require('../api/auth');
const data = require('../api/data');
const settings = require('../api/settings');

const PAGES = {'/': 'index.html', '/index.html': 'index.html', '/dashboard': 'dashboard.html', '/dashboard.html': 'dashboard.html'};
const HANDLERS = {'/api/auth': auth, '/api/data': data, '/api/settings': settings};
const CSP = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
  "font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";
const HEADER_LIMIT = 8192;
const BODY_LIMIT = 10240;
const TOTAL_LIMIT = 20480;

function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
  });
  res.end(body);
}

async function startServer({publicDir, host = '127.0.0.1', port = 0} = {}) {
  if (!publicDir) throw new Error('publicDir is required');
  const directory = path.resolve(publicDir);
  let boundPort = 0;
  const expectedHost = () => `${host}:${boundPort}`;
  const expectedOrigin = () => `http://${host}:${boundPort}`;

  async function handle(req, res) {
    try {
      if (String(req.headers.host || '') !== expectedHost()) return sendJson(res, 403, {error: '请求来源不受支持'});
      const url = new URL(String(req.url || '/'), expectedOrigin());
      const pathname = url.pathname;
      if (!pathname.startsWith('/api/')) {
        if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, {error: '不支持此请求'});
        const page = PAGES[pathname];
        if (!page) return sendJson(res, 404, {error: '未找到'});
        let body;
        try { body = fs.readFileSync(path.join(directory, page)); } catch { return sendJson(res, 404, {error: '页面不可用'}); }
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Length': body.length,
          'Cache-Control': 'no-store',
          'Content-Security-Policy': CSP,
          'X-Content-Type-Options': 'nosniff',
          'X-Frame-Options': 'DENY',
          'Referrer-Policy': 'same-origin',
        });
        return res.end(req.method === 'HEAD' ? undefined : body);
      }
      const handler = HANDLERS[pathname];
      if (!handler) return sendJson(res, 404, {error: '未找到'});
      const total = Number(req.headers['content-length'] || 0);
      if (!Number.isFinite(total) || total < 0 || total > TOTAL_LIMIT) return sendJson(res, 413, {error: '请求过大'});
      const origin = req.headers.origin;
      if (origin && origin !== expectedOrigin()) return sendJson(res, 403, {error: '请求来源不受支持'});
      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (Buffer.byteLength(body) > BODY_LIMIT) { req.destroy(); return sendJson(res, 413, {error: '请求过大'}); }
      }
      let parsed = {};
      if (body) { try { parsed = JSON.parse(body); } catch { return sendJson(res, 400, {error: '请求格式错误'}); } }
      const wrapped = {
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: parsed,
        setHeader: (name, value) => res.setHeader(name, value),
        status(code) { res.statusCode = code; return this; },
        json(value) {
          const text = JSON.stringify(value);
          if (!res.headersSent) {
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.setHeader('Content-Length', Buffer.byteLength(text));
            res.setHeader('Cache-Control', 'no-store');
            res.setHeader('X-Content-Type-Options', 'nosniff');
          }
          res.statusCode = res.statusCode >= 400 ? res.statusCode : (res.statusCode || 200);
          res.end(text);
          return this;
        },
      };
      await handler(wrapped, wrapped);
    } catch {
      if (!res.headersSent) sendJson(res, 500, {error: '服务异常'});
      else res.end();
    }
  }

  const server = http.createServer({maxHeaderSize: HEADER_LIMIT}, (req, res) => { void handle(req, res); });
  server.requestTimeout = 30000;
  server.headersTimeout = 15000;
  server.on('clientError', (error, socket) => {
    try { socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'); } catch {}
  });
  await new Promise((resolve, reject) => {
    const onError = error => { server.removeListener('listening', onListening); reject(error); };
    const onListening = () => { server.removeListener('error', onError); resolve(); };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
  boundPort = server.address().port;
  return {
    server,
    port: boundPort,
    origin: expectedOrigin(),
    url: expectedOrigin() + '/',
    close: () => new Promise(resolve => {
      server.close(() => resolve());
      if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    }),
  };
}

module.exports = {startServer, CSP, HEADER_LIMIT, BODY_LIMIT, TOTAL_LIMIT};
