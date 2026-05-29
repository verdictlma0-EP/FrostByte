let tabs = [];
let activeTab = null;

function newTab() {
  const id = Date.now().toString();

  // each tab gets its own iframe. they deserve their own space. unlike me apparently
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;top:50px;left:0;width:100%;height:calc(100% - 50px);border:none;display:none';

  document.body.appendChild(frame);

  const tab = { id, frame, title: "New Tab", url: "" };

  tabs.push(tab);
  activeTab = id;

  renderTabs();
  showTab(tab);
}

function renderTabs() {
  const el = document.getElementById("tabs");
  // rebuild every time. gave up trying to reuse code.
  el.innerHTML = `<button class="tab-add" onclick="newTab()">＋</button>`;

  tabs.forEach(t => {
    const d = document.createElement("div");
    d.className = "tab" + (t.id === activeTab ? " active" : "");
    d.innerHTML = `${t.title.slice(0,12)} <span onclick="closeTab('${t.id}')">×</span>`;
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
    // just fall back to the first tab. whatever
    activeTab = tabs[0].id;
    showTab(tabs[0]);
  }

  renderTabs();
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

function showTab(tab) {
  tabs.forEach(t => t.frame.style.display = "none");
  if (tab?.frame) tab.frame.style.display = "block";
}

function back() {
  const t = tabs.find(x => x.id === activeTab);
  // SecurityError from cross-origin. can't do anything about it. just pretend it didn't happen
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

function updateClock() {
  const now = new Date();
  // at least the clock works. something has to
  document.getElementById("clock").textContent =
    now.toLocaleTimeString() + " " + now.toLocaleDateString();
}
setInterval(updateClock, 1000);

function openDiscordPopup() {
  document.getElementById("discord").style.display = "flex";
}

function closeDiscord() {
  document.getElementById("discord").style.display = "none";
}

function joinDiscord() {
  window.open("https://discord.gg/bd8Ap9er5U", "_blank");
}

function openSettings() {
  window.location.href = "/settings.html";
}

window.onload = () => {
  newTab();
  updateClock();
  openDiscordPopup();
};
