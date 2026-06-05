function initPanic(settings) {
  document.addEventListener("keydown", e => {
    if (e.key === settings.panicKey) {
      window.location.href = settings.panicUrl;
    }
  });
}
