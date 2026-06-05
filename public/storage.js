function loadSettings() {
  return {
    ...window.DEFAULTS,
    ...JSON.parse(localStorage.getItem("fb_settings") || "{}")
  };
}

function saveSettingsData(data) {
  localStorage.setItem("fb_settings", JSON.stringify(data));
}
