import { sql } from 'drizzle-orm';
import { loadEventConfigs } from '../src/core/event-config.js';
import { seedEvents } from '../src/db/seed-events.js';
import { buildApp } from '../src/server.js';
import { migratedMemoryDb, silentLogger, testConfig, validForm } from './helpers.js';

// Pongal 2027 opens 2026-11-20 8:00 PM ET (01:00Z) and closes 2026-11-24 11:59 PM ET (04:59Z next day).
export const BEFORE_OPEN = new Date('2026-11-21T00:30:00Z'); // 7:30 PM ET Nov 20
export const OPEN = new Date('2026-11-21T01:05:00Z'); // 8:05 PM ET Nov 20
export const AFTER_CLOSE = new Date('2026-11-25T05:01:00Z'); // 12:01 AM ET Nov 25
export const NOV_25 = new Date('2026-11-25T15:00:00Z');

export const TOKEN_PATH = /\/s\/pongal-2027\/edit\/([A-Za-z0-9_-]{43})/;

/** Form body with repeated keys for arrays, as a browser posts it. */
export function encodeForm(fields) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) params.append(key, item);
  }
  return params.toString();
}

/** Full app on a migrated in-memory database with the real event configs and a settable clock. */
export async function surveyApp({ config = {}, ...options } = {}) {
  const database = await migratedMemoryDb();
  await seedEvents(database.db, loadEventConfigs(), silentLogger);
  const clock = { now: OPEN };
  const app = await buildApp(testConfig(config), { database, now: () => clock.now, ...options });
  app.addHook('onClose', () => database.close());

  const post = (url, fields, headers = {}) =>
    app.inject({ method: 'POST', url, headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers }, payload: encodeForm(fields) });
  const submit = (overrides = {}, headers) => post('/s/pongal-2027', validForm(overrides), headers);
  const count = async (table) => (await database.db.execute(sql.raw(`select count(*)::int as n from ${table}`))).rows[0].n;
  return { app, db: database.db, clock, post, submit, count };
}
