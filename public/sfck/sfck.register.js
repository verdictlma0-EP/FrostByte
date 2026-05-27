(function(global) {
  'use strict';

  if (!('serviceWorker' in navigator)) {
    console.warn('[sfck] Service workers not supported');
    return;
  }

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
      } catch(e) { return null; }
    }
  };

  const PREFIX  = '/sfck/service/';
  const TAB_ID  = Math.random().toString(36).slice(2, 10);

  let _backend = (typeof SFCK_BACKEND !== 'undefined' ? SFCK_BACKEND : null)
              || localStorage.getItem('ep_backend_url')
              || 'https://scramfck.onrender.com';
  _backend = _backend.replace(/\/+$/, '');

  let _swReg    = null;
  let _swPort   = null;
  let _ready    = false;
  const _queue  = [];

  const _cookieJar = {};

  function _sendInit(sw) {
    const channel = new MessageChannel();
    _swPort = channel.port1;
    _swPort.onmessage = _onSwPortMessage;
    _swPort.start();

    sw.postMessage({
      $controller$init: { id: TAB_ID, prefix: PREFIX, backend: _backend }
    }, [channel.port2]);

    console.log('[sfck] controller init sent, tabId:', TAB_ID, 'backend:', _backend);
  }

  function _onSwPortMessage(e) {
    if (!e.data || typeof e.data !== 'object') return;
    const data = e.data;

    if (data.type === 'SW_READY') {
      console.log('[sfck] SW ready, tabId:', data.tabId);
      _ready = true;
      _queue.forEach(fn => fn());
      _queue.length = 0;
      return;
    }

    if (data.type === 'RPC_FETCH' && data.reqId) {
      _handleRpcFetch(data);
      return;
    }
  }

  async function _handleRpcFetch({ reqId, url, init }) {
    try {
      const r = await fetch(url, init || {});
      const text = await r.text();
      _swPort.postMessage({ type: 'RPC_RESPONSE', reqId, result: { status: r.status, body: text } });
    } catch(err) {
      _swPort.postMessage({ type: 'RPC_RESPONSE', reqId, error: err.message });
    }
  }

  navigator.serviceWorker.addEventListener('message', e => {
    const data = e.data;
    if (!data) return;

    if (data.type === 'SW_REVIVED') {
      console.log('[sfck] SW revived, re-sending init');
      const sw = navigator.serviceWorker.controller;
      if (sw) _sendInit(sw);
      return;
    }

    if (data.$controller$setCookie) {
      const { cookies, origin, id } = data.$controller$setCookie;
      if (!_cookieJar[origin]) _cookieJar[origin] = {};
      (cookies || []).forEach(c => {
        if (c.isDelete) delete _cookieJar[origin][c.name];
        else             _cookieJar[origin][c.name] = c.value;
      });
      if (id && e.source) {
        e.source.postMessage({ $sw$setCookieDone: { id } });
      }
      return;
    }
  });

  async function _register() {
    try {
      const swUrl = _backend + '/public/sfck/sfck.sw.js';

      _swReg = await navigator.serviceWorker.register(swUrl, { scope: '/' });
      console.log('[sfck] SW registered, scope:', _swReg.scope);

      const sw = _swReg.active || _swReg.installing || _swReg.waiting;

      if (_swReg.active) {
        _sendInit(_swReg.active);
      } else if (sw) {
        sw.addEventListener('statechange', function onState() {
          if (sw.state === 'activated') {
            sw.removeEventListener('statechange', onState);
            _sendInit(sw);
          }
        });
      }

      _swReg.addEventListener('updatefound', () => {
        const newSW = _swReg.installing;
        if (!newSW) return;
        newSW.addEventListener('statechange', () => {
          if (newSW.state === 'activated') _sendInit(newSW);
        });
      });

      navigator.serviceWorker.addEventListener('controllerchange', () => {
        const sw = navigator.serviceWorker.controller;
        if (sw) _sendInit(sw);
      });

    } catch(err) {
      console.warn('[sfck] SW registration failed:', err.message);
    }
  }

  function _whenReady(fn) {
    if (_ready) fn();
    else _queue.push(fn);
  }

  function _navigate(url) {
    if (!url) return;
    const encoded = CODEC.encode(url);
    const path = PREFIX + encoded;
    history.pushState(null, '', path);
    return path;
  }

  function _encode(url) { return CODEC.encode(url); }
  function _decode(enc) { return CODEC.decode(enc); }
  function _getBackend() { return _backend; }
  function _setBackend(url) {
    _backend = (url || '').replace(/\/+$/, '');
    localStorage.setItem('ep_backend_url', _backend);
    const sw = navigator.serviceWorker.controller;
    if (sw) sw.postMessage({ type: 'SET_BACKEND', backend: _backend });
  }

  global.SfckProxy = {
    whenReady:  _whenReady,
    navigate:   _navigate,
    encode:     _encode,
    decode:     _decode,
    getBackend: _getBackend,
    setBackend: _setBackend,
    PREFIX,
    CODEC,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _register);
  } else {
    _register();
  }

})(window);
