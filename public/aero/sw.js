'use strict';

const SCOPE   = '/aero/service/';
const BACKEND = self.location.origin;

const BLOCKED = new Set([
  'content-security-policy', 'content-security-policy-report-only',
  'x-frame-options', 'x-content-type-options', 'strict-transport-security',
  'permissions-policy', 'cross-origin-embedder-policy',
  'cross-origin-opener-policy', 'cross-origin-resource-policy',
  'report-to', 'nel', 'expect-ct', 'feature-policy', 'transfer-encoding',
  'set-cookie',
]);

self.addEventListener('install',  () => self.skipWaiting());
self.addEventListener('activate', e  => e.waitUntil(self.clients.claim()));

function decodeTarget(url) {
  const path = url.pathname.slice(SCOPE.length);
  if (!path) return null;
  try {
    return decodeURIComponent(path) + (url.search || '');
  } catch {
    return null;
  }
}

function fetchUrl(targetUrl) {
  return `${BACKEND}/fetch?url=${encodeURIComponent(targetUrl)}`;
}

self.addEventListener('fetch', event => {
  const reqUrl = new URL(event.request.url);
  if (!reqUrl.pathname.startsWith(SCOPE)) return;
  event.respondWith(handle(event.request, reqUrl));
});

async function handle(request, reqUrl) {
  const target = decodeTarget(reqUrl);
  if (!target) return new Response('Bad aero URL', { status: 400 });

  let resp;
  try {
    resp = await fetch(fetchUrl(target), {
      method: request.method === 'GET' ? 'GET' : request.method,
      headers: {
        'Accept':          request.headers.get('accept')          || '*/*',
        'Accept-Language': request.headers.get('accept-language') || 'en-US,en;q=0.9',
      },
      redirect: 'follow',
    });
  } catch (err) {
    return errorPage(target, err.message);
  }

  const headers = new Headers();
  headers.set('Access-Control-Allow-Origin', '*');
  for (const [k, v] of resp.headers.entries()) {
    if (!BLOCKED.has(k.toLowerCase())) headers.set(k, v);
  }

  const ct = (resp.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (ct === 'text/html' || ct === 'application/xhtml+xml') {
    const html    = await resp.text();
    const origin  = (() => { try { return new URL(target).origin; } catch { return ''; } })();
    const patched = injectShim(html, target, origin);
    headers.set('Content-Type', 'text/html; charset=utf-8');
    headers.delete('content-length');
    return new Response(patched, { status: resp.status, headers });
  }

  return new Response(resp.body, { status: resp.status, headers });
}

function injectShim(html, targetUrl, origin) {
  const shim = `<script>
(function(){
  var _SCOPE  = '/aero/service/';
  var _TARGET = ${JSON.stringify(targetUrl)};

  function _abs(url) {
    if (!url) return url;
    try { return new URL(url, _TARGET).href; } catch { return url; }
  }
  function _wrap(url) {
    if (!url) return url;
    var a = _abs(url);
    if (!a) return url;
    if (a.startsWith('data:') || a.startsWith('blob:') || a.startsWith('javascript:') || a.startsWith('#')) return url;
    if (a.includes(_SCOPE)) return url;
    return _SCOPE + encodeURIComponent(a);
  }

  var _origFetch = self.fetch;
  self.fetch = function(input, init) {
    if (typeof input === 'string') input = _wrap(input);
    else if (input && input.url) input = new Request(_wrap(input.url), input);
    return _origFetch.call(this, input, init);
  };

  var _origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url) {
    var args = Array.prototype.slice.call(arguments);
    args[1] = _wrap(String(url));
    return _origOpen.apply(this, args);
  };

  var _patchNav = function(fn) {
    return function(state, title, url) {
      return fn.call(history, state, title, url ? _wrap(String(url)) : url);
    };
  };
  history.pushState    = _patchNav(history.pushState);
  history.replaceState = _patchNav(history.replaceState);
})();
</script>`;

  var headIdx = html.toLowerCase().indexOf('<head');
  if (headIdx !== -1) {
    var closeIdx = html.indexOf('>', headIdx);
    if (closeIdx !== -1) {
      return html.slice(0, closeIdx + 1) + shim + html.slice(closeIdx + 1);
    }
  }
  return shim + html;
}

function errorPage(url, msg) {
  return new Response(
    `<!DOCTYPE html><html><head><meta charset="utf-8">
    <style>body{background:#020a12;color:#ff6b5b;font-family:sans-serif;padding:2rem}
    code{background:#0d1f2d;padding:2px 6px;border-radius:3px}</style></head>
    <body><h2>Aero Proxy - Error</h2>
    <p>Could not load <code>${url}</code></p>
    <p><code>${msg}</code></p></body></html>`,
    { status: 502, headers: { 'Content-Type': 'text/html' } }
  );
}
