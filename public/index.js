'use strict';

const ENGINES = [
  { id: 'scramjet', label: 'Scramjet' },
  { id: 'uv', label: 'Ultraviolet' },
  { id: 'sfck', label: 'Sfck' },
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
  document.getElementById('engine-label').textContent = id;
  document.getElementById('engine-select').value = id;
}

/* ---------------- TAB STATE ---------------- */

let tabs = [];
let activeTab = null;
let dragTabId = null;

/* ---------------- TAB SYSTEM ---------------- */

function newTab(url = '') {
  const id = 'tab-' + Date.now();

  const iframe = document.createElement('iframe');
  iframe.style.cssText =
    'position:fixed;top:50px;left:0;width:100%;height:calc(100% - 50px);border:none;display:none;z-index:100;';

  document.body.appendChild(iframe);

  const tab = {
    id,
    url,
    title: 'New Tab',
    frame: iframe
  };

  tabs.push(tab);
  activeTab = id;

  renderTabs();

  if (url) navigate(url);
  else showTab(tab);
}

function closeTab(id) {
  const tab = tabs.find(t => t.id === id);
  if (tab?.frame) tab.frame.remove();

  tabs = tabs.filter(t => t.id !== id);

  if (activeTab === id && tabs.length) {
    activeTab = tabs[tabs.length - 1].id;
    showTab(tabs[tabs.length - 1]);
  }

  renderTabs();
}

function switchTab(id) {
  const tab = tabs.find(t => t.id === id);
  if (!tab) return;

  activeTab = id;
  showTab(tab);
  renderTabs();
}

/* ---------------- DRAG + RENDER ---------------- */

function renderTabs() {
  const container = document.getElementById('tabs');
  container.innerHTML = '';

  tabs.forEach(tab => {
    const el = document.createElement('div');
    el.className = 'tab' + (tab.id === activeTab ? ' active' : '');
    el.draggable = true;

    el.textContent = tab.title.slice(0, 14);

    el.onclick = () => switchTab(tab.id);

    const x = document.createElement('span');
    x.className = 'tab-close';
    x.textContent = '×';
    x.onclick = (e) => {
      e.stopPropagation();
      closeTab(tab.id);
    };

    el.appendChild(x);

    /* DRAG EVENTS */

    el.addEventListener('dragstart', () => {
      dragTabId = tab.id;
      el.classList.add('dragging');
    });

    el.addEventListener('dragend', () => {
      dragTabId = null;
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('drag-over'));
    });

    el.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (!dragTabId || dragTabId === tab.id) return;
      el.classList.add('drag-over');
    });

    el.addEventListener('dragleave', () => {
      el.classList.remove('drag-over');
    });

    el.addEventListener('drop', (e) => {
      e.preventDefault();

      if (!dragTabId || dragTabId === tab.id) return;

      const from = tabs.findIndex(t => t.id === dragTabId);
      const to = tabs.findIndex(t => t.id === tab.id);

      const moved = tabs.splice(from, 1)[0];
      tabs.splice(to, 0, moved);

      renderTabs();
    });

    container.appendChild(el);
  });
}

/* ---------------- NAVIGATION ---------------- */

function getProxyUrl(raw, engine) {
  let url = raw.trim();

  if (!/^https?:\/\//i.test(url)) {
    if (url.includes('.')) url = 'https://' + url;
    else url = 'https://www.google.com/search?q=' + encodeURIComponent(url);
  }

  if (engine === 'uv') return '/service/' + __uv$config.encodeUrl(url);
  if (engine === 'sfck') return '/sfck/service/' + btoa(url);

  return '/scramjet/service/' + encodeURIComponent(url);
}

function navigate(raw) {
  const tab = tabs.find(t => t.id === activeTab);
  if (!tab) return;

  const engine = getEngine();
  const proxyUrl = getProxyUrl(raw, engine);

  tab.frame.src = proxyUrl;
  tab.url = raw;
  tab.title = raw;

  document.getElementById('search').value = raw;

  showTab(tab);
  renderTabs();
}

/* ---------------- VIEW ---------------- */

function showTab(tab) {
  tabs.forEach(t => t.frame && (t.frame.style.display = 'none'));
  if (tab?.frame) tab.frame.style.display = 'block';
  document.querySelector('.center').style.display = 'none';
}

/* ---------------- CONTROLS ---------------- */

function back() {
  const tab = tabs.find(t => t.id === activeTab);
  try { tab.frame.contentWindow.history.back(); } catch {}
}

function forward() {
  const tab = tabs.find(t => t.id === activeTab);
  try { tab.frame.contentWindow.history.forward(); } catch {}
}

function reload() {
  const tab = tabs.find(t => t.id === activeTab);
  try { tab.frame.contentWindow.location.reload(); }
  catch { tab.frame.src = tab.frame.src; }
}

/* ---------------- INIT ---------------- */

document.addEventListener('DOMContentLoaded', () => {
  const sel = document.getElementById('engine-select');

  ENGINES.forEach(e => {
    const opt = document.createElement('option');
    opt.value = e.id;
    opt.textContent = e.label;
    sel.appendChild(opt);
  });

  sel.value = getEngine();
  sel.addEventListener('change', e => setEngine(e.target.value));

  updateEngineUI(getEngine());

  document.getElementById('search').addEventListener('keydown', e => {
    if (e.key === 'Enter') navigate(e.target.value);
  });

  newTab();
});

/* expose */
window.newTab = newTab;
window.back = back;
window.forward = forward;
window.reload = reload;
