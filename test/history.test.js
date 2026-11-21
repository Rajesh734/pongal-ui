import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inTransaction, writeHistory } from '../src/db/history.js';
import { createHousehold, findActiveByEmail, listActive, softDeleteHousehold } from '../src/db/repos/households.js';
import { changeHistory, households } from '../src/db/schema/index.js';
import { migratedMemoryDb } from './helpers.js';

let database;
let db;
beforeAll(async () => {
  database = await migratedMemoryDb();
  db = database.db;
});
afterAll(() => database.close());

const historyFor = (id) => db.select().from(changeHistory).where(eq(changeHistory.entityId, id));

describe('change history', () => {
  it('Household created', async () => {
    const row = await createHousehold(db, { email: 'priya@example.com', name: 'Priya' }, 'public');
    const [entry] = await historyFor(row.id);
    expect(entry).toMatchObject({ entityType: 'household', action: 'create', actor: 'public' });
    expect(entry.snapshot.email).toBe('priya@example.com');
    expect(entry.createdAt).toBeInstanceOf(Date);
  });

  it('Change fails', async () => {
    const row = await createHousehold(db, { email: 'ravi@example.com', name: 'Ravi' }, 'public');
    await expect(
      inTransaction(db, async (tx) => {
        await tx.update(households).set({ name: 'Changed' }).where(eq(households.id, row.id));
        throw new Error('failure before history was written');
      }),
    ).rejects.toThrow('failure before history was written');
    const [current] = await db.select().from(households).where(eq(households.id, row.id));
    expect(current.name).toBe('Ravi');
    expect(await historyFor(row.id)).toHaveLength(1);
  });

  it('rolls back the row when writing history fails', async () => {
    const row = await createHousehold(db, { email: 'meena@example.com', name: 'Meena' }, 'public');
    await expect(
      inTransaction(db, async (tx) => {
        await tx.update(households).set({ name: 'Changed' }).where(eq(households.id, row.id));
        await writeHistory(tx, 'household', row.id, 'not-an-action', {}, 'public');
      }),
    ).rejects.toThrow();
    const [current] = await db.select().from(households).where(eq(households.id, row.id));
    expect(current.name).toBe('Meena');
  });
});

describe('households repo', () => {
  it('Mixed-case email', async () => {
    const existing = await createHousehold(db, { email: 'kavya@example.com', name: 'Kavya' }, 'public');
    const found = await findActiveByEmail(db, '  Kavya@Example.COM ');
    expect(found.id).toBe(existing.id);
    await expect(createHousehold(db, { email: 'KAVYA@example.com', name: 'Dup' }, 'public')).rejects.toThrow();
    const stored = await createHousehold(db, { email: '  Arun@Example.com ', name: 'Arun' }, 'public');
    expect(stored.email).toBe('arun@example.com');
  });

  it('Soft delete', async () => {
    const row = await createHousehold(db, { email: 'gone@example.com', name: 'Gone' }, 'public');
    const before = Date.now();
    await softDeleteHousehold(db, row.id, 'admin@example.com');

    const [stored] = await db.select().from(households).where(eq(households.id, row.id));
    expect(stored.deletedAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(await findActiveByEmail(db, 'gone@example.com')).toBeNull();
    expect((await listActive(db)).map((h) => h.id)).not.toContain(row.id);
    const actions = (await historyFor(row.id)).map((h) => h.action);
    expect(actions).toEqual(['create', 'delete']);
  });
});
