const { createHash } = require('node:crypto');
const { readFileSync, readdirSync, writeFileSync } = require('node:fs');
const hash = createHash('sha256');
for (const file of readdirSync('.').filter(file => /\.(js|html|css)$/.test(file)).sort()) hash.update(readFileSync(file));
for (const file of ['dist/firebase-adapter.js', 'dist/scanner.js', 'dist/tailwind.css']) hash.update(readFileSync(file));
writeFileSync('dist/build-version.js', `self.MACROTRACKER_BUILD = '${hash.digest('hex').slice(0, 16)}';\n`);
