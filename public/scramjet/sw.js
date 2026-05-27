importScripts('./scramjet.bundle.js');
const sj = new ScramjetController({
  files: {
    wasm: '/scramjet/scramjet.wasm.wasm',
    worker: '/scramjet/scramjet.bundle.js',
    client: '/scramjet/scramjet.bundle.js',
    shared: '/scramjet/scramjet.bundle.js',
    sync: '/scramjet/scramjet.sync.js',
  },
  flags: { rewriteWorkers: true, rewriteMedia: true },
});
sj.init();
