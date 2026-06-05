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
