// Keep the store singleton in the app module graph rather than bundling a second store.
const fs = require('node:fs');
const bundled = fs.readFileSync('dist/firebase-adapter.js', 'utf8');
fs.writeFileSync('dist/firebase-adapter.js', bundled.replaceAll('"./cloud-model.js"', '"../cloud-model.js"'));
