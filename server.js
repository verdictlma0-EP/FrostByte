'use strict';

// this file became the dumping ground for every proxy experiment
// surprisingly most of it still works


const express     = require('express');
const http        = require('http');
const https       = require('https');
const axios       = require('axios');
const path        = require('path');
const compression = require('compression');
const httpProxy   = require('http-proxy');

const { server: wispServer } = require('@mercuryworkshop/wisp-js/server');
const { rewriteHtml, rewriteCss, rewriteJs } = require('./rewrite/engine');

const uploadRouter = require('./routes/upload');
const userRouter   = require('./routes/user');

const app  = express();
const PORT = process.env.PORT || 3000;
const BACKEND_URL = (process.env.BACKEND_URL || `http://localhost:${PORT}`).replace(/\/+$/, '');

const RH_PORT = process.env.RH_PORT || 8008;
let rhReady = false;

function startRammerhead() {
  try {
    const rh = require('rammerhead');
    const rhServer = (rh.createServer || rh.default || rh)({
      port: RH_PORT,
      logLevel: 'warn',
      reverseProxy: true,
      crossDomainWorkers: true,
      generateClientDir: path.join(__dirname, 'node_modules/rammerhead/src/client'),
    });

    const srv = rhServer.server || rhServer;
    if (srv && srv.listen && !srv.listening) {
      srv.listen(RH_PORT, () => {
        console.log(`[Frostbyte] Rammerhead on :${RH_PORT}`);
        rhReady = true;
      });
    } else {
      rhReady = true;
      console.log(`[Frostbyte] Rammerhead attached on :${RH_PORT}`);
    }
  } catch (e) {
    console.warn('[Frostbyte] Rammerhead not installed — /rh/ will return 503.');
    // leaving this warning because i forgot rammerhead existed for like 2 weeks
    console.warn('  Install with: npm install rammerhead');
  }
}

startRammerhead();

const rhProxy = httpProxy.createProxyServer({
  target: `http://127.0.0.1:${RH_PORT}`,
  ws: true,
  changeOrigin: true,
});

rhProxy.on('error', (err, _req, res) => {
  if (res && res.writeHead) res.status
    ? res.status(503).send('Rammerhead unavailable')
    : (res.writeHead(503), res.end('Rammerhead unavailable'));
});

const ENGINE_COOKIE = 'fb_engine';
const VALID_ENGINES = new Set(['scramjet', 'uv', 'aero', 'rammerhead', 'fetch']);

const agentOptions = { keepAlive: true, maxSockets: 100, timeout: 60000 };
const httpAgent    = new http.Agent(agentOptions);
const httpsAgent   = new https.Agent(agentOptions);

// tiny cache because some school wifi setups were unbearably slow 
const cache    = new Map();
const CACHE_TTL = 1000 * 30;

app.use(compression());

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, HEAD, PATCH');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Range');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    version: 'Frostbyte-Turbo',
    ts: Date.now(),
    engines: {
      scramjet: true,
      uv:       true,
      aero:     true,
      rammerhead: rhReady,
      fetch:    true,
    }
  });
});

app.get('/api/proxy/engines', (req, res) => {
  const current = req.headers.cookie
    ?.split(';')
    .map(c => c.trim().split('='))
    .find(([k]) => k === ENGINE_COOKIE)?.[1] || 'scramjet';

  res.json({
    current,
    engines: [
      { id: 'scramjet',   label: 'Scramjet',    available: true,    description: 'Fast service-worker proxy (default)' },
      { id: 'uv',         label: 'Ultraviolet', available: true,    description: 'Classic UV service-worker proxy' },
      { id: 'aero',       label: 'Aero',        available: true,    description: 'Aero service-worker proxy' },
      { id: 'rammerhead', label: 'Rammerhead',  available: rhReady, description: 'Session-based proxy' },
      { id: 'fetch',      label: 'Fetch/Direct',available: true,    description: 'Server-side HTML rewriter' },
    ]
  });
});

app.post('/api/proxy/engine', (req, res) => {
  const { engine } = req.body;
  if (!engine || !VALID_ENGINES.has(engine)) {
    return res.status(400).json({ error: 'Invalid engine', valid: [...VALID_ENGINES] });
  }
  if (engine === 'rammerhead' && !rhReady) {
    return res.status(503).json({ error: 'Rammerhead is not available on this server' });
  }
  res.setHeader('Set-Cookie', `${ENGINE_COOKIE}=${engine}; Path=/; SameSite=Lax`);
  res.json({ ok: true, engine });
});

app.use('/rh', (req, res) => {
  if (!rhReady) return res.status(503).send('Rammerhead not available');
  req.url = req.url.replace(/^\/rh/, '') || '/';
  rhProxy.web(req, res);
});

function getCache(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.time > CACHE_TTL) { cache.delete(key); return null; }
  return hit.data;
}
function setCache(key, data) { cache.set(key, { time: Date.now(), data }); }

const REWRITE_LIMIT = 15 * 1024 * 1024;

app.get('/fetch', async (req, res) => {
  const rawUrl = req.query.url;
  if (!rawUrl) return res.status(400).json({ error: 'Missing url' });

  let targetUrl;
  try { targetUrl = new URL(rawUrl); }
  catch { return res.status(400).json({ error: 'Invalid URL' }); }

  const cacheKey = targetUrl.href;
  const cached   = getCache(cacheKey);
  if (cached) { res.setHeader('X-Cache', 'HIT'); return res.send(cached); }

  try {
    const upstream = await axios({
      method: 'GET',
      url: targetUrl.href,
      responseType: 'stream',
      timeout: 30000,
      decompress: true,
      maxRedirects: 10,
      validateStatus: () => true,
      httpAgent, httpsAgent,
      headers: {
        'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0 Chrome/124',
        'Referer': targetUrl.origin + '/'
      }
    });

    const contentType = (upstream.headers['content-type'] || '').split(';')[0];
    const isHtml = contentType.includes('text/html');
    const isCss  = contentType.includes('text/css');
    const isJs   = contentType.includes('javascript');

    if (!isHtml && !isCss && !isJs) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      upstream.data.pipe(res);
      return;
    }

    const chunks = [];
    let size = 0;

    upstream.data.on('data', chunk => {
      size += chunk.length;
      if (size > REWRITE_LIMIT) { upstream.data.destroy(); res.end(); return; }
      chunks.push(chunk);
    });

    upstream.data.on('end', () => {
      const buf = Buffer.concat(chunks);
      let output;
      try {
        if (isHtml) {
          output = rewriteHtml(buf.toString('utf8'), targetUrl.href, BACKEND_URL);
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
        } else if (isCss) {
          output = rewriteCss(buf.toString('utf8'), targetUrl.href, BACKEND_URL);
          res.setHeader('Content-Type', 'text/css; charset=utf-8');
        } else if (isJs) {
          output = rewriteJs(buf.toString('utf8'), targetUrl.href, BACKEND_URL);
          res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        }
        res.setHeader('Access-Control-Allow-Origin', '*');
        if (isHtml) setCache(cacheKey, output);
        res.send(output);
      } catch (e) {
        res.status(500).send('Rewrite error');
      }
    });

  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.use('/scramjet', express.static(path.join(__dirname, 'public/scramjet')));
app.use('/uv',       express.static(path.join(__dirname, 'public/uv')));
app.use('/aero',     express.static(path.join(__dirname, 'public/aero')));

app.use('/upload', uploadRouter);
app.use('/user',   userRouter);

const server = http.createServer(app);

server.on('upgrade', (req, socket, head) => {
  if (req.url.startsWith('/wisp/')) {
    wispServer.routeRequest(req, socket, head);
  } else if (req.url.startsWith('/rh/')) {
    if (!rhReady) return socket.end();
    req.url = req.url.replace(/^\/rh/, '') || '/';
    rhProxy.ws(req, socket, head);
  } else {
    socket.end();
  }
});

server.listen(PORT, () => {
  console.log(`[Frostbyte Turbo] running on :${PORT}`);
});
