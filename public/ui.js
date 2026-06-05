let tabs = [];
let activeTab = null;
let settings = loadSettings();

function newTab() {
  const id = Date.now().toString();

  const frame = document.createElement("iframe");
  frame.style.cssText =
    "position:fixed;top:50px;left:0;width:100%;height:calc(100% - 50px);border:none;display:none";

  document.body.appendChild(frame);

  const tab = {
    id,
    frame,
    title: "New Tab",
    url: ""
  };

  tabs.push(tab);
  activeTab = id;

  renderTabs();
  showTab(tab);
}

function renderTabs() {
  const el = document.getElementById("tabs");
  el.innerHTML = "";

  tabs.forEach(t => {
    const d = document.createElement("div");
    d.className = "tab" + (t.id === activeTab ? " active" : "");

    const title = document.createElement("span");
    title.textContent = t.title.slice(0, 12);

    const close = document.createElement("span");
    close.textContent = " ×";
    close.onclick = (e) => {
      e.stopPropagation();
      closeTab(t.id);
    };

    d.onclick = () => switchTab(t.id);

    d.appendChild(title);
    d.appendChild(close);

    el.appendChild(d);
  });

  const add = document.createElement("button");
  add.className = "tab-add";
  add.textContent = "＋";
  add.onclick = newTab;

  el.appendChild(add);
}

function switchTab(id) {
  activeTab = id;
  const tab = tabs.find(t => t.id === id);
  if (tab) showTab(tab);
  renderTabs();
}

function closeTab(id) {
  const t = tabs.find(x => x.id === id);
  if (t?.frame) t.frame.remove();

  tabs = tabs.filter(x => x.id !== id);

  if (activeTab === id && tabs.length) {
    activeTab = tabs[tabs.length - 1].id;
    showTab(tabs[tabs.length - 1]);
  }

  renderTabs();
}

function showTab(tab) {
  tabs.forEach(t => (t.frame.style.display = "none"));
  if (tab?.frame) tab.frame.style.display = "block";
}

function navigate(url) {
  const tab = tabs.find(t => t.id === activeTab);
  if (!tab) return;

  tab.frame.src = "/scramjet/service/" + encodeURIComponent(url);
  tab.url = url;
  tab.title = url;

  showTab(tab);
  renderTabs();
}

function back() {
  const t = tabs.find(x => x.id === activeTab);
  try {
    t?.frame?.contentWindow?.history?.back();
  } catch {}
}

function forward() {
  const t = tabs.find(x => x.id === activeTab);
  try {
    t?.frame?.contentWindow?.history?.forward();
  } catch {}
}

function reload() {
  const t = tabs.find(x => x.id === activeTab);
  try {
    t?.frame?.contentWindow?.location?.reload();
  } catch {}
}

function openSettings() {
  window.location.href = "/settings.html";
}

function openPopout() {
  window.open(window.location.href, "_blank", "width=1200,height=800");
}

function updateClock() {
  const el = document.getElementById("clock");
  if (!el) return;

  const now = new Date();
  el.textContent =
    now.toLocaleTimeString() + " " + now.toLocaleDateString();
}

function initUI() {
  newTab();
  updateClock();
  setInterval(updateClock, 1000);
}

/* PANIC KEY (safe version) */
document.addEventListener("keydown", e => {
  if (!settings) return;
  if (e.key === settings.panicKey) {
    window.location.href = settings.panicUrl;
  }
});

/* CLOAK APPLY */
function applyCloak(mode) {
  const map = {
    frostbyte: { title: "Frostbyte OS", icon: "logo.png" },
    study: { title: "Study Dashboard", icon: "https://www.google.com/favicon.ico" },
    docs: { title: "Documents", icon: "https://ssl.gstatic.com/docs/documents/images/kix-favicon7.ico" }
  };

  const c = map[mode] || map.frostbyte;

  document.title = c.title;

  let link = document.querySelector("link[rel='icon']");
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }

  link.href = c.icon;
}
