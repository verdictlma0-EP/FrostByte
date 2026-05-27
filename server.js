'use strict';

const express  = require('express');
const http     = require('http');
const https    = require('https');
const axios    = require('axios');
const path     = require('path');
const compression = require('compression');

const { server: wispServer } = require('@mercuryworkshop/wisp-js/server');
const { rewriteHtml, rewriteCss, rewriteJs } = require('./rewrite/engine');

const uploadRouter = require('./routes/upload');
const userRouter   = require('./routes/user');

const app  = express();
const PORT = process.env.PORT || 3000;
const BACKEND_URL = (process.env.BACKEND_URL || `http://localhost:${PORT}`).replace(/\/+$/, '');

/* -------------------- PERFORMANCE CORE -------------------- */

// Keep-alive agents (major speed boost)
const agentOptions = {
  keepAlive: true,
  maxSockets: 100,
  timeout: 60000
};

const httpAgent = new http.Agent(agentOptions);
const httpsAgent = new https.Agent(agentOptions);

// simple in-memory cache
const cache = new Map();
const CACHE_TTL = 1000 * 30;

/* -------------------- MIDDLEWARE -------------------- */

app.use(compression());

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, HEAD, PATCH');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, X-Requested-With, Range'
  );
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

app.use(express.static(path.join(__dirname, 'public')));

/* -------------------- BASIC ROUTES -------------------- */

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    version: 'Frostbyte-Turbo',
    ts: Date.now()
  });
});

/* -------------------- CACHE HELPERS -------------------- */

function getCache(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.time > CACHE_TTL) {
    cache.delete(key);
    return null;
  }
  return hit.data;
}

function setCache(key, data) {
  cache.set(key, { time: Date.now(), data });
}

/* -------------------- FETCH PROXY (FAST MODE) -------------------- */

const REWRITE_LIMIT = 15 * 1024 * 1024;

app.get('/fetch', async (req, res) => {
  const rawUrl = req.query.url;
  if (!rawUrl) return res.status(400).json({ error: 'Missing url' });

  let targetUrl;
  try {
    targetUrl = new URL(rawUrl);
  } catch {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  const cacheKey = targetUrl.href;
  const cached = getCache(cacheKey);
  if (cached) {
    res.setHeader('X-Cache', 'HIT');
    return res.send(cached);
  }

  try {
    const upstream = await axios({
      method: 'GET',
      url: targetUrl.href,
      responseType: 'stream',
      timeout: 30000,
      decompress: true,
      maxRedirects: 10,
      validateStatus: () => true,
      httpAgent,
      httpsAgent,
      headers: {
        'User-Agent': req.headers['user-agent'] ||
          'Mozilla/5.0 Chrome/124',
        'Referer': targetUrl.origin + '/'
      }
    });

    const contentType = (upstream.headers['content-type'] || '').split(';')[0];

    const isHtml = contentType.includes('text/html');
    const isCss  = contentType.includes('text/css');
    const isJs   = contentType.includes('javascript');

    // 🚀 FAST PATH: no rewrite needed
    if (!isHtml && !isCss && !isJs) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      upstream.data.pipe(res);
      return;
    }

    // 🚀 STREAM BUFFER (only for rewrite cases)
    const chunks = [];
    let size = 0;

    upstream.data.on('data', chunk => {
      size += chunk.length;
      if (size > REWRITE_LIMIT) {
        upstream.data.destroy();
        res.end();
        return;
      }
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

        // cache ONLY html (biggest win)
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

/* -------------------- WISP (WebSocket proxy) -------------------- */

const server = http.createServer(app);

server.on('upgrade', (req, socket, head) => {
  if (req.url.startsWith('/wisp/')) {
    wispServer.routeRequest(req, socket, head);
  } else {
    socket.end();
  }
});

/* -------------------- STATIC ENGINE -------------------- */

app.use('/scramjet', express.static(path.join(__dirname, 'public/scramjet')));
app.use('/uv', express.static(path.join(__dirname, 'public/uv')));
app.use('/aero', express.static(path.join(__dirname, 'public/aero')));

/* -------------------- START -------------------- */

server.listen(PORT, () => {
  console.log(`[Frostbyte Turbo] running on :${PORT}`);
});
