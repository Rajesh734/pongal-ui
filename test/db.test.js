import { sql } from 'drizzle-orm';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { createDatabase } from '../src/db/index.js';
import { createHousehold, findActiveByEmail } from '../src/db/repos/households.js';
import { migratedMemoryDb, migrationsWithExtra, recordingLogger, silentLogger, tempDir, testConfig } from './helpers.js';

const open = [];
afterEach(async () => {
  while (open.length) await open.pop().close();
});

async function tableNames(db) {
  const res = await db.execute(sql`select table_name from information_schema.tables where table_schema = 'public' order by table_name`);
  return res.rows.map((r) => r.table_name);
}

describe('driver selection', () => {
  it('Unsupported driver', async () => {
    expect(() => loadConfig({ DB_DRIVER: 'mysql', EDIT_TOKEN_KEY: 'k' })).toThrow(
      "Unsupported DB_DRIVER 'mysql'. Use 'pglite' or 'postgres'.",
    );
    await expect(createDatabase(testConfig({ DB_DRIVER: 'mysql' }), silentLogger)).rejects.toThrow(
      "Unsupported DB_DRIVER 'mysql'. Use 'pglite' or 'postgres'.",
    );
  });

  it('PostgreSQL connection settings', () => {
    expect(() =>
      loadConfig({ DB_DRIVER: 'postgres', EDIT_TOKEN_KEY: 'k', DATABASE_HOST: 'db', DATABASE_NAME: 'site', DATABASE_USER: 'app' }),
    ).toThrow('Missing required setting: DATABASE_PASSWORD (set DATABASE_PASSWORD or DATABASE_PASSWORD_FILE)');
  });

  it('Embedded in-memory database for tests', async () => {
    const logger = recordingLogger();
    const database = await createDatabase(testConfig(), logger);
    open.push(database);
    expect(database.driver).toBe('pglite');
    expect(logger.lines).toContainEqual({ level: 'warn', msg: 'PGlite running in memory - data will not be kept' });
    await expect(database.ping()).resolves.toBeDefined();
  });

  it('Embedded database with persistent folder', async () => {
    const dataDir = path.join(tempDir(), 'pglite');
    const first = await createDatabase(testConfig({ PGLITE_DATA_DIR: dataDir }), silentLogger);
    await first.migrate();
    await createHousehold(first.db, { email: 'priya@example.com', name: 'Priya' }, 'public');
    await first.close();

    const second = await createDatabase(testConfig({ PGLITE_DATA_DIR: dataDir }), silentLogger);
    open.push(second);
    await second.migrate();
    const found = await findActiveByEmail(second.db, 'priya@example.com');
    expect(found.name).toBe('Priya');
  });
});

describe('migrations', () => {
  it('Fresh database', async () => {
    const database = await migratedMemoryDb();
    open.push(database);
    expect(await tableNames(database.db)).toEqual(['change_history', 'event_days', 'events', 'households']);
  });

  it('Restart with no new migrations', async () => {
    const database = await migratedMemoryDb();
    open.push(database);
    await createHousehold(database.db, { email: 'a@example.com', name: 'A' }, 'public');
    const before = await database.db.execute(sql`select count(*)::int as n from drizzle.__drizzle_migrations`);
    await database.migrate();
    const after = await database.db.execute(sql`select count(*)::int as n from drizzle.__drizzle_migrations`);
    expect(after.rows[0].n).toBe(before.rows[0].n);
    expect((await findActiveByEmail(database.db, 'a@example.com')).name).toBe('A');
  });

  it('Failed migration', async () => {
    const database = await migratedMemoryDb();
    open.push(database);
    const folder = migrationsWithExtra('0001_broken', 'CREATE TABLE "half_done" ("id" int);\n--> statement-breakpoint\nSELECT * FROM "no_such_table";');
    await expect(database.migrate(folder)).rejects.toThrow();
    expect(await tableNames(database.db)).not.toContain('half_done');
    const applied = await database.db.execute(sql`select count(*)::int as n from drizzle.__drizzle_migrations`);
    expect(applied.rows[0].n).toBe(1);
  });
});
