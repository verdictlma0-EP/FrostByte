'use strict';

const CODEC = {
  encode(str) {
    if (!str) return str;
    let out = '';
    for (let i = 0; i < str.length; i++) out += String.fromCharCode(str.charCodeAt(i) ^ 3);
    return btoa(out).replace(/\+/g, '_').replace(/\//g, '-').replace(/=/g, '');
  },
  decode(enc) {
    if (!enc) return enc;
    const b64 = enc.replace(/_/g, '+').replace(/-/g, '/');
    const padded = b64 + '==='.slice((b64.length + 3) % 4);
    try {
      const raw = atob(padded);
      let out = '';
      for (let i = 0; i < raw.length; i++) out += String.fromCharCode(raw.charCodeAt(i) ^ 3);
      return out;
    } catch (e) {
      return null;
    }
  }
};
const PREFIX = '/sfck/service/';
const EXEMPT = /^(data:|blob:|javascript:|about:|mailto:|tel:|#)/i;
function exemptUrl(url) {
  return !url || typeof url !== 'string' || EXEMPT.test(url.trim());
}
const BLOCKED_HEADERS = new Set(['content-security-policy', 'content-security-policy-report-only', 'x-frame-options', 'x-content-type-options', 'strict-transport-security', 'permissions-policy', 'cross-origin-embedder-policy', 'cross-origin-opener-policy', 'cross-origin-resource-policy', 'report-to', 'nel', 'transfer-encoding', 'expect-ct', 'feature-policy']);
let _idb = null;
async function openIDB() {
  if (_idb) return _idb;
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('sfck_cookies', 1);
    req.onupgradeneeded = e => {
      e.target.result.createObjectStore('cookies', {
        keyPath: 'k'
      });
    };
    req.onsuccess = e => {
      _idb = e.target.result;
      resolve(_idb);
    };
    req.onerror = e => reject(e.target.error);
  });
}
async function idbGetCookies(origin) {
  try {
    const db = await openIDB();
    return new Promise((res, rej) => {
      const tx = db.transaction('cookies', 'readonly');
      const req = tx.objectStore('cookies').get(origin);
      req.onsuccess = () => res(req.result ? req.result.cookies : {});
      req.onerror = () => res({});
    });
  } catch {
    return {};
  }
}
async function idbSetCookies(origin, cookies) {
  try {
    const db = await openIDB();
    return new Promise((res, rej) => {
      const tx = db.transaction('cookies', 'readwrite');
      tx.objectStore('cookies').put({
        k: origin,
        cookies
      });
      tx.oncomplete = () => res();
      tx.onerror = () => res();
    });
  } catch {}
}
async function getCookieHeader(targetUrl) {
  try {
    const origin = new URL(targetUrl).origin;
    const cookies = await idbGetCookies(origin);
    const pairs = Object.entries(cookies);
    return pairs.length ? pairs.map(([k, v]) => `${k}=${v}`).join('; ') : null;
  } catch {
    return null;
  }
}
async function absorbSetCookie(headers, targetUrl) {
  const raw = headers.get('set-cookie');
  if (!raw) return;
  try {
    const origin = new URL(targetUrl).origin;
    const cookies = await idbGetCookies(origin);
    for (const part of raw.split(',')) {
      const eq = part.indexOf('=');
      if (eq < 0) continue;
      const name = part.slice(0, eq).split(';')[0].trim();
      const rest = part.slice(eq + 1);
      const value = rest.split(';')[0].trim();
      const lower = part.toLowerCase();
      const isDelete = /max-age\s*=\s*0/.test(lower) || /expires\s*=/.test(lower);
      if (isDelete) delete cookies[name];else cookies[name] = value;
    }
    await idbSetCookies(origin, cookies);
  } catch {}
}
const tabs = new Map();
class ControllerTab {
  constructor(id, prefix, backend, port) {
    this.id = id;
    this.prefix = prefix;
    this.backend = (backend || 'https://scramfck.onrender.com').replace(/\/+$/, '');
    this.port = port;
    this._pending = new Map();
    this._nextId = 1;
    port.onmessage = e => this._onMessage(e.data);
    port.onmessageerror = e => console.error('[sfck sw] port error', e);
    this._post({
      type: 'SW_READY',
      tabId: id
    });
  }
  _post(data, transfer) {
    try {
      this.port.postMessage(data, transfer || []);
    } catch (e) {}
  }
  _onMessage(data) {
    if (!data || typeof data !== 'object') return;
    if (data.type === 'RPC_RESPONSE' && data.reqId) {
      const p = this._pending.get(data.reqId);
      if (p) {
        this._pending.delete(data.reqId);
        if (data.error) p.reject(new Error(data.error));else p.resolve(data.result);
      }
      return;
    }
    if (data.$sw$setCookieDone) {}
  }
  async rpcFetch(url, reqInit) {
    return new Promise((resolve, reject) => {
      const id = this._nextId++;
      const timeout = setTimeout(() => {
        this._pending.delete(id);
        reject(new Error('RPC timeout'));
      }, 5000);
      this._pending.set(id, {
        resolve: v => {
          clearTimeout(timeout);
          resolve(v);
        },
        reject: e => {
          clearTimeout(timeout);
          reject(e);
        }
      });
      this._post({
        type: 'RPC_FETCH',
        reqId: id,
        url,
        init: reqInit
      });
    });
  }
}
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => {
  e.waitUntil(self.clients.claim().then(async () => {
    const allClients = await self.clients.matchAll({
      type: 'window'
    });
    for (const client of allClients) {
      try {
        client.postMessage({
          type: 'SW_REVIVED'
        });
      } catch {}
    }
  }));
});
self.addEventListener('message', e => {
  const data = e.data;
  if (!data || typeof data !== 'object') return;
  if (data.$controller$init && e.ports && e.ports[0]) {
    const {
      id,
      prefix,
      backend
    } = data.$controller$init;
    tabs.delete(id);
    const tab = new ControllerTab(id, prefix || PREFIX, backend, e.ports[0]);
    tabs.set(id, tab);
    return;
  }
  if (data.type === 'SET_BACKEND' && data.backend) {
    for (const tab of tabs.values()) tab.backend = data.backend.replace(/\/+$/, '');
    return;
  }
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (!url.pathname.startsWith(PREFIX)) return;
  e.respondWith(handleFetch(e.request, url));
});
async function handleFetch(request, url) {
  const encoded = url.pathname.slice(PREFIX.length);
  if (!encoded) return new Response('Missing URL', {
    status: 400
  });
  const decoded = CODEC.decode(encoded);
  if (!decoded || exemptUrl(decoded)) {
    return new Response('Invalid or exempt URL', {
      status: 400
    });
  }
  let backend = 'https://scramfck.onrender.com';
  for (const tab of tabs.values()) {
    if (tab.backend) {
      backend = tab.backend;
      break;
    }
  }
  const proxyTarget = decoded + (url.search || '');
  const fetchUrl = `${backend}/fetch?url=${encodeURIComponent(proxyTarget)}`;
  try {
    const reqHeaders = {};
    for (const [k, v] of request.headers.entries()) {
      const kl = k.toLowerCase();
      if (['accept', 'accept-language', 'accept-encoding', 'cache-control', 'range', 'if-modified-since', 'if-none-match'].includes(kl)) {
        reqHeaders[k] = v;
      }
    }
    const cookieHeader = await getCookieHeader(decoded);
    if (cookieHeader) reqHeaders['x-sfck-cookie'] = cookieHeader;
    const init = {
      method: request.method,
      headers: reqHeaders,
      redirect: 'follow'
    };
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      init.body = await request.arrayBuffer();
    }
    const resp = await fetch(fetchUrl, init);
    await absorbSetCookie(resp.headers, decoded);
    const respHeaders = new Headers();
    respHeaders.set('Access-Control-Allow-Origin', '*');
    for (const [k, v] of resp.headers.entries()) {
      if (!BLOCKED_HEADERS.has(k.toLowerCase()) && k.toLowerCase() !== 'set-cookie') {
        respHeaders.set(k, v);
      }
    }
    return new Response(resp.body, {
      status: resp.status,
      headers: respHeaders
    });
  } catch (err) {
    console.error('[sfck sw] fetch error:', err.message);
    return new Response(`<html><body style="background:#020a12;color:#ff6b5b;font-family:sans-serif;padding:2rem">
        <h2>ScramFck: Fetch Error</h2>
        <p>${err.message}</p>
        <p><small>URL: ${decoded}</small></p>
      </body></html>`, {
      status: 502,
      headers: {
        'Content-Type': 'text/html'
      }
    });
  }
}
