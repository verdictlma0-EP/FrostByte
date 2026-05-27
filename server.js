'use strict';

const express  = require('express');
const http     = require('http');
const axios    = require('axios');
const path     = require('path');
const { server: wispServer } = require('@mercuryworkshop/wisp-js/server');
const { rewriteHtml, rewriteCss, rewriteJs, buildShim } = require('./rewrite/engine');
const uploadRouter = require('./routes/upload');
const userRouter   = require('./routes/user');

const app  = express();
const PORT = process.env.PORT || 3000;
const BACKEND_URL = (process.env.BACKEND_URL || `http://localhost:${PORT}`).replace(/\/+$/, '');

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, HEAD, PATCH');
  res.setHeader('Access-Control-Allow-Headers',
    'Content-Type, Authorization, X-Requested-With, ' +
    'X-YouTube-Client-Name, X-YouTube-Client-Version, X-YouTube-UTC-Offset, ' +
    'X-YouTube-Ad-Signals, X-YouTube-Time-Zone, X-Goog-Api-Key, X-Goog-Visitor-Id, ' +
    'X-Goog-AuthUser, X-Goog-PageId, X-Origin, X-Referer, X-Client-Data, ' +
    'Range, Accept, Accept-Language, Cache-Control, Pragma');
  if (req.method === 'OPTIONS') { res.sendStatus(204); return; }
  next();
});

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

app.use('/public/sfck', (req, res, next) => {
  if (req.path.endsWith('.js')) {
    res.setHeader('Service-Worker-Allowed', '/');
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  }
  next();
}, express.static(path.join(__dirname, 'public/sfck')));

app.use('/uv', (req, res, next) => {
  if (req.path.endsWith('.js')) {
    res.setHeader('Service-Worker-Allowed', '/');
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  }
  next();
}, express.static(path.join(__dirname, 'public/uv')));

app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (_req, res) => res.json({
  status: 'ok', version: '8.0.0', ts: Date.now(),
  engines: ['scramfck','ultraviolet','scramjet','rammerhead','dynamic','aero'],
}));

app.get('/suggest', async (req, res) => {
  const q = req.query.q || '';
  if (!q.trim()) { res.json([]); return; }
  try {
    const r = await axios.get(`https://duckduckgo.com/ac/?q=${encodeURIComponent(q)}&type=list`, {
      timeout: 5000, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; EPProxy/7.0)' }
    });
    res.json(r.data);
  } catch { res.json([]); }
});

app.use('/upload', uploadRouter);
app.use('/api/user', userRouter);

app.post('/api/maintenance', async (req, res) => {
  const adminFb = require('./config/firebase');
  const OWNER_EMAILS = (process.env.OWNER_EMAILS || '').split(',').map(e => e.trim().toLowerCase());

  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No token provided' });

  let decoded;
  try {
    decoded = await adminFb.auth().verifyIdToken(token);
  } catch(e) {
    return res.status(401).json({ error: 'Invalid token: ' + e.message });
  }

  const email = (decoded.email || '').toLowerCase();
  if (!OWNER_EMAILS.includes(email)) {
    return res.status(403).json({ error: 'Forbidden: owner only' });
  }

  const { enable } = req.body;
  if (typeof enable !== 'boolean') {
    return res.status(400).json({ error: 'Body must include { "enable": true | false }' });
  }

  try {
    await adminFb.database().ref('siteSettings/maintenanceMode').set(enable);
    console.log(`[maintenance] ${email} set maintenanceMode=${enable}`);
    res.json({ ok: true, maintenanceMode: enable });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

const BLOCKED_RESP_HEADERS = new Set([
  'content-security-policy', 'content-security-policy-report-only',
  'x-frame-options', 'x-content-type-options', 'strict-transport-security',
  'permissions-policy', 'cross-origin-embedder-policy',
  'cross-origin-opener-policy', 'cross-origin-resource-policy',
  'report-to', 'nel', 'expect-ct', 'feature-policy', 'transfer-encoding', 'set-cookie',
]);

let setCookieParser;
try { setCookieParser = require('set-cookie-parser'); } catch {}
const cookieJar = new Map();

function absorbSetCookie(headers, targetUrl) {
  const raw = headers['set-cookie'];
  if (!raw) return;
  const list = Array.isArray(raw) ? raw : [raw];
  let parsed = [];
  if (setCookieParser) {
    parsed = setCookieParser.parse(list, { decodeValues: false });
  } else {
    for (const h of list) {
      const parts = h.split(';').map(s => s.trim());
      const eq = parts[0].indexOf('=');
      if (eq < 0) continue;
      parsed.push({
        name:    parts[0].slice(0, eq).trim(),
        value:   parts[0].slice(eq + 1).trim(),
        maxAge:  parseInt((parts.slice(1).find(p => /^max-age=/i.test(p)) || '').slice(8)),
        expires: (parts.slice(1).find(p => /^expires=/i.test(p)) || '').slice(8),
      });
    }
  }
  const origin = new URL(targetUrl).origin;
  if (!cookieJar.has(origin)) cookieJar.set(origin, new Map());
  const jar = cookieJar.get(origin);
  for (const c of parsed) {
    if (!c.name) continue;
    const del = (!isNaN(c.maxAge) && c.maxAge <= 0) || (c.expires && new Date(c.expires) < new Date());
    if (del) jar.delete(c.name); else jar.set(c.name, { name: c.name, value: c.value });
  }
}

function getCookieHeader(targetUrl) {
  const jar = cookieJar.get(new URL(targetUrl).origin);
  if (!jar || !jar.size) return null;
  return [...jar.values()].map(c => `${c.name}=${c.value}`).join('; ');
}

const FORWARD_REQ_HEADERS = new Set([
  'accept', 'accept-encoding', 'accept-language', 'cache-control',
  'pragma', 'range', 'if-modified-since', 'if-none-match',
  'content-type', 'content-length', 'authorization', 'x-requested-with',
]);

function buildProxyHeaders(reqHeaders, targetUrl) {
  const out = {
    'User-Agent': reqHeaders['user-agent'] ||
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36',
    'Referer': new URL(targetUrl).origin + '/',
    'Origin':  new URL(targetUrl).origin,
  };
  for (const k of FORWARD_REQ_HEADERS) {
    if (reqHeaders[k]) out[k] = reqHeaders[k];
  }
  const cookie = getCookieHeader(targetUrl);
  if (cookie) out['Cookie'] = cookie;
  return out;
}

app.all('/youtubei/*', async (req, res) => {
  const ytPath = req.path;
  let ytHost = 'www.youtube.com';
  try {
    const ref = new URL(req.headers['referer'] || '');
    const decoded = ref.searchParams.get('url') || '';
    if (decoded) { const u = new URL(decoded); ytHost = u.hostname; }
  } catch {}
  const qs = req.url.includes('?') ? '?' + req.url.split('?')[1] : '';
  const targetUrl = `https://${ytHost}${ytPath}${qs}`;
  try {
    const r = await axios({
      method: req.method,
      url:    targetUrl,
      headers: {
        'Content-Type':             'application/json',
        'User-Agent':               'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36',
        'Origin':                   `https://${ytHost}`,
        'Referer':                  `https://${ytHost}/`,
        'X-YouTube-Client-Name':    req.headers['x-youtube-client-name']    || '1',
        'X-YouTube-Client-Version': req.headers['x-youtube-client-version'] || '2.20240101',
        'X-Goog-Visitor-Id':        req.headers['x-goog-visitor-id']        || '',
        'X-Goog-AuthUser':          req.headers['x-goog-authuser']           || '0',
        'Authorization':            req.headers['authorization']             || '',
      },
      data:           req.method === 'POST' ? JSON.stringify(req.body) : undefined,
      timeout:        20000,
      validateStatus: () => true,
      decompress:     true,
    });
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', r.headers['content-type'] || 'application/json');
    res.status(r.status).send(r.data);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.get('/s/*', async (req, res) => {
  const qs = req.url.includes('?') ? '?' + req.url.split('?')[1] : '';
  const targetUrl = `https://www.youtube.com${req.path}${qs}`;
  try {
    const upstream = await axios({
      method: 'GET',
      url:    targetUrl,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36',
        'Referer':    'https://www.youtube.com/',
        'Origin':     'https://www.youtube.com',
        ...(req.headers['range'] ? { 'Range': req.headers['range'] } : {}),
      },
      responseType:   'stream',
      timeout:        20000,
      validateStatus: () => true,
    });
    res.status(upstream.status);
    for (const [k, v] of Object.entries(upstream.headers)) {
      if (!BLOCKED_RESP_HEADERS.has(k.toLowerCase())) res.setHeader(k, v);
    }
    res.setHeader('Access-Control-Allow-Origin', '*');
    upstream.data.pipe(res);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.get('/generate_204', (_req, res) => res.status(204).end());

const REWRITE_SIZE_LIMIT = 20 * 1024 * 1024;

app.get('/fetch', async (req, res) => {
  const rawUrl = req.query.url;
  if (!rawUrl) return res.status(400).json({ error: 'Missing url parameter' });

  let targetUrl;
  try {
    targetUrl = new URL(rawUrl);
    if (!/^https?:$/i.test(targetUrl.protocol)) throw new Error('Only http/https');
  } catch (e) {
    return res.status(400).json({ error: 'Invalid URL: ' + e.message });
  }

  const host = targetUrl.hostname.toLowerCase();
  if (/^(localhost|127\.|0\.0\.0\.0|::1|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)) {
    return res.status(403).json({ error: 'Private addresses not allowed' });
  }

  try {
    const proxyHeaders = buildProxyHeaders(req.headers, targetUrl.href);
    const upstream = await axios({
      method:         req.method === 'POST' ? 'POST' : 'GET',
      url:            targetUrl.href,
      headers:        proxyHeaders,
      responseType:   'stream',
      timeout:        30000,
      maxRedirects:   10,
      decompress:     true,
      validateStatus: () => true,
      data:           req.method === 'POST' ? req.body : undefined,
    });

    const contentType = (upstream.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    const isHtml = contentType === 'text/html' || contentType === 'application/xhtml+xml';
    const isCss  = contentType === 'text/css';
    const isJs   = ['application/javascript', 'text/javascript', 'application/x-javascript',
                     'application/ecmascript', 'text/ecmascript'].includes(contentType);
    const needsRewrite = isHtml || isCss || isJs;

    const respHeaders = { 'Access-Control-Allow-Origin': '*' };
    for (const [k, v] of Object.entries(upstream.headers)) {
      if (!BLOCKED_RESP_HEADERS.has(k.toLowerCase())) respHeaders[k] = v;
    }
    res.status(upstream.status);
    for (const [k, v] of Object.entries(respHeaders)) res.setHeader(k, v);

    if (!needsRewrite) {
      upstream.data.pipe(res);
      upstream.data.on('error', () => { if (!res.headersSent) res.end(); });
      return;
    }

    const chunks = [];
    let totalSize = 0, aborted = false;
    upstream.data.on('data', chunk => {
      if (aborted) return;
      totalSize += chunk.length;
      if (totalSize > REWRITE_SIZE_LIMIT) {
        aborted = true;
        upstream.data.destroy();
        if (!res.headersSent) res.end();
        return;
      }
      chunks.push(chunk);
    });
    upstream.data.on('end', () => {
      if (aborted) return;
      absorbSetCookie(upstream.headers, targetUrl.href);
      const buf = Buffer.concat(chunks);
      try {
        if (isHtml) {
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.removeHeader('Content-Length');
          res.send(rewriteHtml(buf.toString('utf8'), targetUrl.href, BACKEND_URL));
        } else if (isCss) {
          res.setHeader('Content-Type', 'text/css; charset=utf-8');
          res.removeHeader('Content-Length');
          res.send(rewriteCss(buf.toString('utf8'), targetUrl.href, BACKEND_URL));
        } else if (isJs) {
          const isModule = /\.mjs(\?|$)/.test(targetUrl.pathname);
          res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
          res.removeHeader('Content-Length');
          res.send(rewriteJs(buf.toString('utf8'), targetUrl.href, BACKEND_URL, isModule));
        }
      } catch (rewriteErr) {
        console.error(`[fetch:rewrite] ${targetUrl.href} → ${rewriteErr.message}`);
        if (!res.headersSent) res.status(502).json({ error: 'Rewrite error' });
      }
    });
    upstream.data.on('error', err => {
      if (!res.headersSent) res.status(502).json({ error: 'Stream error' });
    });
  } catch (err) {
    console.error(`[fetch] ${targetUrl?.href} → ${err.message}`);
    if (!res.headersSent) res.status(502).json({ error: 'Upstream error: ' + err.message });
  }
});

const CODEC = {
  encode(str) {
    let out = '';
    for (let i = 0; i < str.length; i++) out += String.fromCharCode(str.charCodeAt(i) ^ 3);
    return Buffer.from(out, 'binary').toString('base64').replace(/\+/g, '_').replace(/\//g, '-').replace(/=/g, '');
  },
  decode(enc) {
    if (!enc) return null;
    const b64 = enc.replace(/_/g, '+').replace(/-/g, '/');
    const padded = b64 + '==='.slice((b64.length + 3) % 4);
    try {
      const raw = Buffer.from(padded, 'base64').toString('binary');
      let out = '';
      for (let i = 0; i < raw.length; i++) out += String.fromCharCode(raw.charCodeAt(i) ^ 3);
      return out;
    } catch { return null; }
  },
};

app.get('/sfck/service/*', (req, res) => {
  const encoded = req.params[0];
  if (!encoded) return res.status(400).send('Missing encoded URL');
  const decoded = CODEC.decode(encoded);
  if (!decoded) return res.status(400).send('Invalid encoded URL');
  res.redirect(302, `/fetch?url=${encodeURIComponent(decoded)}`);
});

app.get('/dynamic', async (req, res) => {
  const rawUrl = req.query.url;
  if (!rawUrl) return res.status(400).json({ error: 'Missing url parameter' });
  let targetUrl;
  try { targetUrl = decodeURIComponent(rawUrl); } catch { targetUrl = rawUrl; }
  if (!/^https?:\/\//.test(targetUrl)) return res.status(400).json({ error: 'Invalid URL' });
  try {
    const r = await axios({
      method: 'GET',
      url: targetUrl,
      headers: buildProxyHeaders(req.headers, targetUrl),
      responseType: 'arraybuffer',
      timeout: 25000,
      validateStatus: () => true,
      decompress: true,
    });
    absorbSetCookie(r.headers, targetUrl);
    for (const [k, v] of Object.entries(r.headers)) {
      if (!BLOCKED_RESP_HEADERS.has(k.toLowerCase())) {
        try { res.setHeader(k, v); } catch {}
      }
    }
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('X-Proxy-Engine', 'dynamic');
    res.status(r.status).send(Buffer.from(r.data));
  } catch (err) {
    res.status(502).json({ error: 'Dynamic proxy error: ' + err.message });
  }
});

app.use('/scramjet', (req, res, next) => {
  if (req.path.endsWith('.js') || req.path.endsWith('.wasm')) {
    res.setHeader('Service-Worker-Allowed', '/');
    res.setHeader('Content-Type', req.path.endsWith('.wasm')
      ? 'application/wasm'
      : 'application/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  }
  next();
}, express.static(path.join(__dirname, 'public/scramjet')));

app.use('/aero', (req, res, next) => {
  if (req.path.endsWith('.js')) {
    res.setHeader('Service-Worker-Allowed', '/');
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  }
  next();
}, express.static(path.join(__dirname, 'public/aero')));

app.get('/aero/sw.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Service-Worker-Allowed', '/');
  res.send(`
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  const encoded = url.pathname.replace('/aero/service/', '');
  if (!encoded) return;
  try {
    const target = decodeURIComponent(encoded);
    event.respondWith(fetch(target, { credentials: 'omit' }));
  } catch(e) {}
});
`);
});

const rhSessions = new Map();
const generateRhId = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

app.get('/rammerhead/newsession', (req, res) => {
  const id = generateRhId();
  rhSessions.set(id, { created: Date.now(), cookies: new Map() });
  setTimeout(() => rhSessions.delete(id), 7200000);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.send(id);
});

app.get('/rammerhead/:session/:url(*)', async (req, res) => {
  const { session } = req.params;
  const rawUrl = req.params.url;
  if (!rhSessions.has(session)) return res.status(404).json({ error: 'Session not found' });
  if (!rawUrl) return res.status(400).json({ error: 'Missing URL' });
  let targetUrl;
  try { targetUrl = decodeURIComponent(rawUrl); } catch { targetUrl = rawUrl; }
  if (!/^https?:\/\//.test(targetUrl)) return res.status(400).json({ error: 'Invalid URL' });
  try {
    const r = await axios({
      method: 'GET', url: targetUrl,
      headers: buildProxyHeaders(req.headers, targetUrl),
      responseType: 'arraybuffer',
      timeout: 25000, validateStatus: () => true, decompress: true,
    });
    absorbSetCookie(r.headers, targetUrl);
    for (const [k, v] of Object.entries(r.headers)) {
      if (!BLOCKED_RESP_HEADERS.has(k.toLowerCase())) {
        try { res.setHeader(k, v); } catch {}
      }
    }
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('X-Proxy-Engine', 'rammerhead');
    res.setHeader('X-RH-Session', session);
    res.status(r.status).send(Buffer.from(r.data));
  } catch (err) {
    res.status(502).json({ error: 'Rammerhead proxy error: ' + err.message });
  }
});

const httpServer = http.createServer(app);

httpServer.on('upgrade', (req, socket, head) => {
  if (req.url && req.url.startsWith('/wisp/')) {
    wispServer.routeRequest(req, socket, head);
  } else {
    socket.end();
  }
});

httpServer.listen(PORT, () => {
  console.log(`[EP Proxy v7] listening on :${PORT}`);
  console.log(`[EP Proxy v7] BACKEND_URL: ${BACKEND_URL}`);
});
