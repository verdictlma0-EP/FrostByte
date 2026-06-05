let settings = loadSettings();

function save() {
  settings.panicKey = document.getElementById("panicKey").value;
  settings.panicUrl = document.getElementById("panicUrl").value;
  settings.cloakMode = document.getElementById("cloakMode").value;
  settings.popout = document.getElementById("popout").checked;

  saveSettingsData(settings);
}

function load() {
  document.getElementById("panicKey").value = settings.panicKey;
  document.getElementById("panicUrl").value = settings.panicUrl;
  document.getElementById("cloakMode").value = settings.cloakMode;
  document.getElementById("popout").checked = settings.popout;
}

load();
