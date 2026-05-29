'use strict';

const ENGINES = [
  { id: 'scramjet', label: 'Scramjet',    description: 'Fast service-worker proxy (default)' },
  { id: 'uv',       label: 'Ultraviolet', description: 'Classic UV service-worker proxy' },
  { id: 'sfck',     label: 'Sfck',        description: 'Session-based service-worker proxy' },
];

const ENGINE_KEY = 'fb_engine';

function getEngine() {
  return localStorage.getItem(ENGINE_KEY) || 'scramjet';
}

function setEngine(id) {
  localStorage.setItem(ENGINE_KEY, id);
  updateEngineUI(id);
}

function updateEngineUI(id) {
  const dot   = document.getElementById('engine-dot');
  const label = document.getElementById('engine-label');
  const sel   = document.getElementById('engine-select');
  if (dot)   dot.style.background = '#8fd3ff';
  if (label) label.textContent = id;
  if (sel)   sel.value = id;
}

let tabs = [];
let activeTab = null;

function newTab(url) {
  const id = 'tab-' + Date.now();
  const tab = { id, title: 'New Tab', url: url || '' };
  tabs.push(tab);
  activeTab = id;
  renderTabs();
  if (url) navigate(url);
  else showHome();
}

function closeTab(id) {
  tabs = tabs.filter(t => t.id !== id);
  if (activeTab === id) {
    activeTab = tabs.length ? tabs[tabs.length - 1].id : null;
  }
  renderTabs();
  if (activeTab) showHome(); else showHome();
}

function switchTab(id) {
  activeTab = id;
  renderTabs();
}

function renderTabs() {
  const container = document.getElementById('tabs');
  if (!container) return;
  container.innerHTML = '';
  tabs.forEach(tab => {
    const el = document.createElement('div');
    el.className = 'tab' + (tab.id === activeTab ? ' active' : '');
    el.textContent = tab.title.length > 18 ? tab.title.slice(0, 18) + '…' : tab.title;
    el.title = tab.title;
    el.onclick = () => switchTab(tab.id);

    const x = document.createElement('span');
    x.className = 'tab-close';
    x.textContent = '×';
    x.onclick = (e) => { e.stopPropagation(); closeTab(tab.id); };
    el.appendChild(x);

    container.appendChild(el);
  });
}

function getProxyUrl(raw, engine) {
  let url = raw.trim();
  if (!/^https?:\/\//i.test(url) && !/^blob:|^data:/i.test(url)) {
    if (/^localhost|\d{1,3}(\.\d{1,3}){3}/.test(url) || url.includes('.') && !url.includes(' ')) {
      url = 'https://' + url;
    } else {
      url = 'https://www.google.com/search?q=' + encodeURIComponent(url);
    }
  }

  switch (engine) {
    case 'scramjet':
      return '/scramjet/scramjet.all.js'.replace('scramjet.all.js', '') + 'service/' + url;
    case 'uv':
      return '/service/' + __uv$config.encodeUrl(url);
    case 'sfck':
      if (window.SfckProxy && window.SfckProxy.navigate) {
        return window.SfckProxy.navigate(url);
      }
      return '/sfck/service/' + btoa(url);
    default:
      return '/service/' + url;
  }
}

function navigate(rawUrl) {
  if (!rawUrl) return;
  const engine = getEngine();
  const proxyUrl = getProxyUrl(rawUrl, engine);
  const frame = getOrCreateFrame();
  frame.src = proxyUrl;

  const tab = tabs.find(t => t.id === activeTab);
  if (tab) { tab.url = rawUrl; tab.title = rawUrl; renderTabs(); }

  document.getElementById('search').value = rawUrl;
  showFrame();
}

function getOrCreateFrame() {
  let frame = document.getElementById('proxy-frame');
  if (!frame) {
    frame = document.createElement('iframe');
    frame.id = 'proxy-frame';
    frame.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;border:none;z-index:100;display:none;';
    document.body.appendChild(frame);
  }
  return frame;
}

function showFrame() {
  const frame = document.getElementById('proxy-frame');
  const center = document.querySelector('.center');
  const topbar = document.querySelector('.topbar');
  if (frame)  { frame.style.display = 'block'; frame.style.top = '50px'; frame.style.height = 'calc(100% - 50px)'; }
  if (center) center.style.display = 'none';
  if (topbar) topbar.style.position = 'fixed'; topbar.style.top='0'; topbar.style.width='100%'; topbar.style.zIndex='200';
}

function showHome() {
  const frame = document.getElementById('proxy-frame');
  const center = document.querySelector('.center');
  if (frame)  frame.style.display = 'none';
  if (center) center.style.display = '';
}

function back() {
  const frame = document.getElementById('proxy-frame');
  if (frame && frame.style.display !== 'none') {
    try { frame.contentWindow.history.back(); } catch(e) {}
  }
}

function forward() {
  const frame = document.getElementById('proxy-frame');
  if (frame && frame.style.display !== 'none') {
    try { frame.contentWindow.history.forward(); } catch(e) {}
  }
}

function reload() {
  const frame = document.getElementById('proxy-frame');
  if (frame && frame.style.display !== 'none') {
    try { frame.contentWindow.location.reload(); } catch(e) { frame.src = frame.src; }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const sel = document.getElementById('engine-select');
  if (sel) {
    ENGINES.forEach(eng => {
      const opt = document.createElement('option');
      opt.value = eng.id;
      opt.textContent = eng.label;
      opt.title = eng.description;
      sel.appendChild(opt);
    });
    sel.value = getEngine();
    sel.addEventListener('change', () => setEngine(sel.value));
  }

  updateEngineUI(getEngine());

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/uv/uv.sw.js', { scope: '/service/' }).catch(() => {});
    navigator.serviceWorker.register('/scramjet/sw.js', { scope: '/scramjet/service/' }).catch(() => {});
  }

  newTab();

  const search = document.getElementById('search');
  if (search) {
    search.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        const val = search.value.trim();
        if (val) navigate(val);
      }
    });
  }
});

window.back    = back;
window.forward = forward;
window.reload  = reload;
window.newTab  = newTab;
