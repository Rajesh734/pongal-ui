import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import { createDatabase, MIGRATIONS_FOLDER } from '../src/db/index.js';

export const silentLogger = { info() {}, warn() {}, error() {} };

export function recordingLogger() {
  const lines = [];
  const push = (level) => (msg) => lines.push({ level, msg });
  return { lines, info: push('info'), warn: push('warn'), error: push('error') };
}

export function testConfig(overrides = {}) {
  return {
    PORT: 3000,
    NODE_ENV: 'test',
    DB_DRIVER: 'pglite',
    DATABASE_PORT: 5432,
    EDIT_TOKEN_KEY: 'test-edit-key',
    ...overrides,
  };
}

export function captureStream() {
  const chunks = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(chunk.toString());
      cb();
    },
  });
  return { stream, text: () => chunks.join(''), lines: () => chunks.join('').split('\n').filter(Boolean).map((l) => JSON.parse(l)) };
}

export function tempDir(prefix = 'pongal-test-') {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

export async function migratedMemoryDb() {
  const database = await createDatabase(testConfig(), silentLogger);
  await database.migrate();
  return database;
}

/** Copy of the real migrations plus one extra migration with the given SQL. */
export function migrationsWithExtra(tag, sqlText) {
  const dir = tempDir('pongal-migrations-');
  cpSync(MIGRATIONS_FOLDER, dir, { recursive: true });
  const journalPath = path.join(dir, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8'));
  journal.entries.push({ idx: journal.entries.length, version: '7', when: Date.now(), tag, breakpoints: true });
  writeFileSync(journalPath, JSON.stringify(journal));
  writeFileSync(path.join(dir, `${tag}.sql`), sqlText);
  return dir;
}
