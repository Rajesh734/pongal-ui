import { readFileSync } from 'node:fs';
import { afterEach, expect, it } from 'vitest';
import { buildApp } from '../src/server.js';
import { testConfig } from './helpers.js';

let app;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

it('serves the shared schema and vendored Zod as JavaScript', async () => {
  app = await buildApp(testConfig(), { database: { ping: async () => {} } });
  for (const url of ['/shared/survey-schema.js', '/shared/survey-messages.js', '/vendor/zod.mjs', '/vendor/alpine-csp.mjs']) {
    const res = await app.inject(url);
    expect(res.statusCode, url).toBe(200);
    expect(res.headers['content-type'], url).toMatch(/^(text|application)\/javascript/);
  }
});

it('shared code uses only Zod APIs present in /vendor/zod.mjs', async () => {
  const { z } = await import('../src/public/vendor/zod.mjs');
  const source = readFileSync(new URL('../src/shared/survey-schema.js', import.meta.url), 'utf8');
  const used = new Set([...source.matchAll(/\bz\.(\w+)/g)].map((match) => match[1]));
  expect(used.size).toBeGreaterThan(0);
  for (const api of used) expect(z[api], `z.${api}`).toBeDefined();
  expect(source).toMatch(/^import \{ z \} from 'zod';$/m);
});
