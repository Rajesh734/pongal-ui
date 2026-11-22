// Regenerates the browser copies of Zod and Alpine (CSP build) in src/public/vendor/.
// Run after upgrading either package: npm run vendor
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const out = new URL('../src/public/vendor/', import.meta.url);
mkdirSync(out, { recursive: true });

const version = (name) => JSON.parse(readFileSync(require.resolve(`${name}/package.json`), 'utf8')).version;

// Only the Zod APIs used by src/shared/ are bundled (the full build is ~450 KB). test/survey-static.test.js
// checks that every z.<api> used in src/shared/ exists in the vendored file.
const ZOD_APIS = ['array', 'config', 'literal', 'NEVER', 'regexes', 'string', 'unknown'];

const zod = await build({
  stdin: {
    contents: `import { ${ZOD_APIS.join(', ')} } from 'zod';\nexport const z = { ${ZOD_APIS.join(', ')} };`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  format: 'esm',
  minify: true,
  write: false,
  legalComments: 'none',
});
writeFileSync(new URL('zod.mjs', out), `/* zod ${version('zod')} (MIT) */\n${zod.outputFiles[0].text}`);

copyFileSync(require.resolve('@alpinejs/csp/dist/module.esm.min.js'), new URL('alpine-csp.mjs', out));
console.log(`Vendored zod ${version('zod')} and @alpinejs/csp ${version('@alpinejs/csp')} into src/public/vendor/`);
