import { readFileSync } from 'node:fs';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MIGRATIONS_FOLDER } from '../src/db/index.js';
import { migratedMemoryDb } from './helpers.js';

let database;
beforeAll(async () => {
  database = await migratedMemoryDb();
});
afterAll(() => database?.close());

describe('migration 0001_survey', () => {
  it('creates the survey tables on in-memory PGlite', async () => {
    const res = await database.db.execute(
      sql`select table_name from information_schema.tables where table_schema = 'public' order by table_name`,
    );
    const names = res.rows.map((r) => r.table_name);
    for (const table of ['survey_responses', 'response_days', 'response_headcounts', 'response_volunteer_roles']) {
      expect(names).toContain(table);
    }
  });

  it('has the partial unique index for active responses', async () => {
    const res = await database.db.execute(
      sql`select indexdef from pg_indexes where indexname = 'ux_response_active'`,
    );
    expect(res.rows[0].indexdef).toMatch(/UNIQUE INDEX ux_response_active .*\(event_id, household_id\) WHERE \(deleted_at IS NULL\)/);
    const file = readFileSync(path.join(MIGRATIONS_FOLDER, '0001_survey.sql'), 'utf8');
    expect(file).toContain('WHERE "survey_responses"."deleted_at" is null');
  });
});
