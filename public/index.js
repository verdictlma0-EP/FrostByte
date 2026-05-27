let tabs = [];
let activeTab = 0;

/* TAB SYSTEM */
function renderTabs() {
    const el = document.getElementById("tabs");
    el.innerHTML = "";

    tabs.forEach((t, i) => {
        const div = document.createElement("div");
        div.className = "tab" + (i === activeTab ? " active" : "");
        div.innerText = t.title || `Tab ${i + 1}`;

        div.onclick = () => {
            activeTab = i;
            renderTabs();
        };

        div.oncontextmenu = (e) => {
            e.preventDefault();
            closeTab(i);
        };

        el.appendChild(div);
    });
}

function newTab() {
    tabs.push({
        url: "",
        title: "New Tab"
    });

    activeTab = tabs.length - 1;
    renderTabs();
}

function closeTab(i) {
    tabs.splice(i, 1);

    if (tabs.length === 0) {
        newTab();
        return;
    }

    if (activeTab >= tabs.length) activeTab = tabs.length - 1;

    renderTabs();
}

/* NAV BUTTONS */
function back() {
    history.back();
}

function forward() {
    history.forward();
}

function reload() {
    location.reload();
}

/* SCRAMJET NAVIGATION */
function go(url) {
    // normalize
    const isUrl = url.includes(".") && !url.includes(" ");

    if (!isUrl) {
        url = "https://www.google.com/search?q=" + encodeURIComponent(url);
    } else if (!url.startsWith("http")) {
        url = "https://" + url;
    }

    // route into Scramjet
    window.location.href = "/scramjet/#" + encodeURIComponent(url);
}

/* SEARCH BAR */
document.getElementById("search").addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;

    const value = e.target.value.trim();
    if (!value) return;

    go(value);
});

/* INIT */
newTab();
renderTabs();
