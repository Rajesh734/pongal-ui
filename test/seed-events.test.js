import { readFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseEventConfig } from '../src/core/event-config.js';
import { formatInZone } from '../src/core/time.js';
import { changeHistory, eventDays, events } from '../src/db/schema/index.js';
import { seedEvents } from '../src/db/seed-events.js';
import { migratedMemoryDb, silentLogger } from './helpers.js';

const FILE = 'config/events/pongal-2027.yaml';
const source = readFileSync(FILE, 'utf8');
const original = parseEventConfig(source, FILE);

let database;
let db;
beforeEach(async () => {
  database = await migratedMemoryDb();
  db = database.db;
});
afterEach(() => database.close());

const eventHistory = () => db.select().from(changeHistory).where(eq(changeHistory.entityType, 'event'));
const stored = async () => (await db.select().from(events).where(eq(events.slug, 'pongal-2027')))[0];

describe('event seeding', () => {
  it('First start', async () => {
    await seedEvents(db, [original], silentLogger);
    const event = await stored();
    expect(event).toBeDefined();
    expect(event.configSnapshot.slug).toBe('pongal-2027');
    const days = await db.select().from(eventDays).where(eq(eventDays.eventId, event.id));
    expect(days).toHaveLength(2);
    const history = await eventHistory();
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ action: 'create', actor: 'system', entityId: event.id });
  });

  it('Close time extended', async () => {
    await seedEvents(db, [original], silentLogger);
    const extended = parseEventConfig(source.replace('closes_at: 2026-11-24T23:59', 'closes_at: 2026-11-25T23:59'), FILE);
    await seedEvents(db, [extended], silentLogger);
    const event = await stored();
    expect(formatInZone(event.surveyClosesAt, event.timezone)).toBe('Wed, Nov 25, 11:59 PM ET');
    const actions = (await eventHistory()).map((h) => [h.action, h.actor]);
    expect(actions).toEqual([['create', 'system'], ['update', 'system']]);
  });

  it('Unchanged file', async () => {
    await seedEvents(db, [original], silentLogger);
    await seedEvents(db, [parseEventConfig(source, FILE)], silentLogger);
    expect(await eventHistory()).toHaveLength(1);
  });

  it('File removed next year', async () => {
    await seedEvents(db, [original], silentLogger);
    const before = await stored();
    await seedEvents(db, [], silentLogger);
    expect(await stored()).toEqual(before);
    expect(await db.select().from(eventDays).where(eq(eventDays.eventId, before.id))).toHaveLength(2);
  });
});
