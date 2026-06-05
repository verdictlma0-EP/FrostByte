let tabs = [];
let activeTab = null;
let settings = loadSettings();

function newTab() {
  const id = Date.now().toString();

  const frame = document.createElement("iframe");
  frame.style.cssText =
    "position:fixed;top:50px;left:0;width:100%;height:calc(100% - 50px);border:none;display:none";

  document.body.appendChild(frame);

  const tab = { id, frame, title: "New Tab", url: "" };

  tabs.push(tab);
  activeTab = id;

  renderTabs();
  showTab(tab);
}

function renderTabs() {
  const el = document.getElementById("tabs");
  el.innerHTML = `<button class="tab-add" onclick="newTab()">＋</button>`;

  tabs.forEach(t => {
    const d = document.createElement("div");
    d.className = "tab" + (t.id === activeTab ? " active" : "");
    d.innerHTML = `${t.title.slice(0, 12)} <span onclick="closeTab('${t.id}')">×</span>`;
    d.onclick = () => switchTab(t.id);
    el.appendChild(d);
  });
}

function switchTab(id) {
  activeTab = id;
  showTab(tabs.find(t => t.id === id));
  renderTabs();
}

function closeTab(id) {
  const t = tabs.find(x => x.id === id);
  if (t?.frame) t.frame.remove();

  tabs = tabs.filter(x => x.id !== id);

  if (activeTab === id && tabs.length) {
    activeTab = tabs[0].id;
    showTab(tabs[0]);
  }

  renderTabs();
}

function navigate(url) {
  const tab = tabs.find(t => t.id === activeTab);
  if (!tab) return;

  tab.frame.src = "/scramjet/service/" + encodeURIComponent(url);
  tab.title = url;

  showTab(tab);
  renderTabs();
}

function showTab(tab) {
  tabs.forEach(t => (t.frame.style.display = "none"));
  if (tab?.frame) tab.frame.style.display = "block";
}

function back() {
  const t = tabs.find(x => x.id === activeTab);
  try { t.frame.contentWindow.history.back(); } catch {}
}

function forward() {
  const t = tabs.find(x => x.id === activeTab);
  try { t.frame.contentWindow.history.forward(); } catch {}
}

function reload() {
  const t = tabs.find(x => x.id === activeTab);
  try { t.frame.contentWindow.location.reload(); } catch {}
}

function openSettings() {
  window.location.href = "/settings.html";
}

function openPopout() {
  window.open(window.location.href, "_blank", "width=1200,height=800");
}

function initUI() {
  newTab();
  setInterval(() => {
    const now = new Date();
    document.getElementById("clock").textContent =
      now.toLocaleTimeString() + " " + now.toLocaleDateString();
  }, 1000);
}
