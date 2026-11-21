import { and, eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { run as removeCli } from '../src/cli/survey-remove.js';
import { loadEventConfigs } from '../src/core/event-config.js';
import { changeHistory, households, surveyResponses } from '../src/db/schema/index.js';
import { seedEvents } from '../src/db/seed-events.js';
import { findActiveByTokenHash, findEventBySlug, loadAnswers } from '../src/modules/survey/repo.js';
import { removeResponse, saveFromEditLink, saveFromPublicForm } from '../src/modules/survey/service.js';
import { generateToken, hashToken, isWellFormedToken } from '../src/modules/survey/tokens.js';
import { buildSurveySchema, validateSurvey } from '../src/shared/survey-schema.js';
import { migratedMemoryDb, silentLogger, validForm } from './helpers.js';

const KEY = 'test-edit-key';
const configs = loadEventConfigs();
const { config } = configs.find((e) => e.config.slug === 'pongal-2027');
const schema = buildSurveySchema(config.survey, config.days);
const answers = (overrides) => {
  const result = validateSurvey(schema, validForm(overrides));
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.data;
};

let database;
let db;
let event;
beforeEach(async () => {
  database = await migratedMemoryDb();
  db = database.db;
  await seedEvents(db, configs, silentLogger);
  event = await findEventBySlug(db, 'pongal-2027');
});
afterEach(() => database.close());

const activeResponses = () => db.select().from(surveyResponses).where(sql`${surveyResponses.deletedAt} is null`);
const history = (entityType) =>
  db.select().from(changeHistory).where(eq(changeHistory.entityType, entityType)).orderBy(changeHistory.id);
const adults = async (responseId) => (await loadAnswers(db, responseId)).headcounts.find((h) => h.code === 'adult_11_plus').count;

describe('edit tokens', () => {
  it('generates 43-character base64url tokens and checks their format', () => {
    const token = generateToken();
    expect(token).toHaveLength(43);
    expect(isWellFormedToken(token)).toBe(true);
    expect(isWellFormedToken(`${token.slice(0, 42)}!`)).toBe(false);
    expect(isWellFormedToken(token.slice(1))).toBe(false);
    expect(hashToken(KEY, token)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('Token not stored in plain form', async () => {
    const { token } = await saveFromPublicForm(db, { event, data: answers(), tokenKey: KEY });
    for (const table of ['households', 'survey_responses', 'response_days', 'response_headcounts', 'response_volunteer_roles', 'change_history']) {
      const res = await db.execute(sql.raw(`select row_to_json(t)::text as j from ${table} t`));
      for (const row of res.rows) expect(row.j).not.toContain(token);
    }
  });
});

describe('saveFromPublicForm', () => {
  it('First submission', async () => {
    const saved = await saveFromPublicForm(db, { event, data: answers({ roles: ['cleanup'] }), tokenKey: KEY });
    expect(saved.created).toBe(true);
    expect(await db.select().from(households)).toHaveLength(1);
    expect(await activeResponses()).toHaveLength(1);
    expect(await loadAnswers(db, saved.response.id)).toEqual({
      days: [{ date: '2027-01-16', likelihood: 'definitely' }],
      headcounts: expect.arrayContaining([{ code: 'adult_11_plus', count: 2 }, { code: 'kids_5_10', count: 1 }]),
      roles: ['cleanup'],
    });
    for (const type of ['household', 'survey_response']) {
      expect(await history(type)).toEqual([expect.objectContaining({ action: 'create', actor: 'public' })]);
    }
  });

  it('Resubmission with same email', async () => {
    const first = await saveFromPublicForm(db, { event, data: answers({ headcount_adult_11_plus: '2' }), tokenKey: KEY });
    const second = await saveFromPublicForm(db, { event, data: answers({ email: 'PRIYA@example.com', headcount_adult_11_plus: '3' }), tokenKey: KEY });
    expect(second.created).toBe(false);
    expect(second.response.id).toBe(first.response.id);
    const active = await activeResponses();
    expect(active).toHaveLength(1);
    expect(await adults(active[0].id)).toBe(3);
    const snapshots = (await history('survey_response')).map((h) => h.snapshot.headcounts.find((c) => c.code === 'adult_11_plus').count);
    expect(snapshots).toEqual([2, 3]);
    expect(second.token).not.toBe(first.token);
    expect(await findActiveByTokenHash(db, event.id, hashToken(KEY, first.token))).toBeNull();
    expect(await findActiveByTokenHash(db, event.id, hashToken(KEY, second.token))).not.toBeNull();
  });

  it('Previously removed response', async () => {
    const first = await saveFromPublicForm(db, { event, data: answers(), tokenKey: KEY });
    await removeResponse(db, { event, email: 'priya@example.com' });
    const again = await saveFromPublicForm(db, { event, data: answers(), tokenKey: KEY });
    expect(again.created).toBe(true);
    expect(again.response.id).not.toBe(first.response.id);
    const [removed] = await db.select().from(surveyResponses).where(eq(surveyResponses.id, first.response.id));
    expect(removed.deletedAt).not.toBeNull();
    expect(await activeResponses()).toHaveLength(1);
  });

  it('Simultaneous submissions', async () => {
    const results = await Promise.all([
      saveFromPublicForm(db, { event, data: answers({ headcount_adult_11_plus: '4' }), tokenKey: KEY }),
      saveFromPublicForm(db, { event, data: answers({ headcount_adult_11_plus: '5' }), tokenKey: KEY }),
    ]);
    const active = await activeResponses();
    expect(active).toHaveLength(1);
    // The save that committed last (the later history row) holds the answers.
    const last = (await history('survey_response')).at(-1).snapshot;
    expect(await adults(active[0].id)).toBe(last.headcounts.find((h) => h.code === 'adult_11_plus').count);
    expect(results.filter((r) => r.created)).toHaveLength(1);
  });

  it('retries once when the active-response index rejects a racing insert', async () => {
    let calls = 0;
    const racing = {
      transaction(fn) {
        calls += 1;
        if (calls === 1) {
          const cause = Object.assign(new Error('duplicate key value violates unique constraint "ux_response_active"'), { code: '23505' });
          return Promise.reject(Object.assign(new Error('Failed query'), { cause }));
        }
        return db.transaction(fn);
      },
    };
    const saved = await saveFromPublicForm(racing, { event, data: answers(), tokenKey: KEY });
    expect(calls).toBe(2);
    expect(saved.response.id).toBeTruthy();
    expect(await activeResponses()).toHaveLength(1);
  });

  it('does not retry other errors', async () => {
    let calls = 0;
    const broken = {
      transaction() {
        calls += 1;
        return Promise.reject(Object.assign(new Error('boom'), { code: '23514' }));
      },
    };
    await expect(saveFromPublicForm(broken, { event, data: answers(), tokenKey: KEY })).rejects.toThrow('boom');
    expect(calls).toBe(1);
  });
});

describe('saveFromEditLink', () => {
  async function savedWithLink() {
    const saved = await saveFromPublicForm(db, { event, data: answers({ headcount_adult_11_plus: '3' }), tokenKey: KEY });
    const found = await findActiveByTokenHash(db, event.id, hashToken(KEY, saved.token));
    return { ...saved, found };
  }

  it('Successful edit', async () => {
    const { token, found } = await savedWithLink();
    await saveFromEditLink(db, { event, ...found, data: answers({ headcount_adult_11_plus: '4' }) });
    const again = await findActiveByTokenHash(db, event.id, hashToken(KEY, token));
    expect(again).not.toBeNull();
    expect(await adults(again.response.id)).toBe(4);
    expect((await history('survey_response')).at(-1)).toMatchObject({ action: 'update', actor: 'public' });
  });

  it('Tampered email ignored', async () => {
    const { found } = await savedWithLink();
    await saveFromEditLink(db, { event, ...found, data: answers({ email: 'other@example.com' }) });
    const all = await db.select().from(households);
    expect(all.map((h) => h.email)).toEqual(['priya@example.com']);
    const [response] = await activeResponses();
    expect(response.householdId).toBe(all[0].id);
  });
});

describe('survey:remove CLI', () => {
  const quiet = () => {
    const lines = [];
    return { lines, log: (l) => lines.push(l), error: (l) => lines.push(l) };
  };

  it('soft-deletes the active response with a system delete history row', async () => {
    const { response } = await saveFromPublicForm(db, { event, data: answers(), tokenKey: KEY });
    const out = quiet();
    expect(await removeCli(['pongal-2027', 'Priya@Example.com'], { db, out })).toBe(0);
    const [row] = await db.select().from(surveyResponses).where(eq(surveyResponses.id, response.id));
    expect(row.deletedAt).not.toBeNull();
    const deletes = await db
      .select()
      .from(changeHistory)
      .where(and(eq(changeHistory.entityId, response.id), eq(changeHistory.action, 'delete')));
    expect(deletes).toEqual([expect.objectContaining({ actor: 'system', entityType: 'survey_response' })]);
    expect(out.lines.join('\n')).toContain('Removed response');
  });

  it('reports a missing response and bad arguments', async () => {
    expect(await removeCli(['pongal-2027', 'nobody@example.com'], { db, out: quiet() })).toBe(1);
    expect(await removeCli(['diwali-1999', 'a@example.com'], { db, out: quiet() })).toBe(1);
    expect(await removeCli([], { db, out: quiet() })).toBe(2);
  });
});
