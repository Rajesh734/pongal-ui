import { and, asc, eq, isNull } from 'drizzle-orm';
import { households } from '../schema/index.js';
import { inTransaction, writeHistory } from '../history.js';

export function normalizeEmail(email) {
  return email.trim().toLowerCase();
}

export async function findActiveByEmail(db, email) {
  const [row] = await db
    .select()
    .from(households)
    .where(and(eq(households.email, normalizeEmail(email)), isNull(households.deletedAt)));
  return row ?? null;
}

export function listActive(db) {
  return db.select().from(households).where(isNull(households.deletedAt)).orderBy(asc(households.createdAt));
}

export function createHousehold(db, { email, name, mobileE164 = null }, actor) {
  return inTransaction(db, async (tx) => {
    const [row] = await tx.insert(households).values({ email: normalizeEmail(email), name, mobileE164 }).returning();
    await writeHistory(tx, 'household', row.id, 'create', row, actor);
    return row;
  });
}

export function softDeleteHousehold(db, id, actor) {
  return inTransaction(db, async (tx) => {
    const now = new Date();
    const [row] = await tx
      .update(households)
      .set({ deletedAt: now, updatedAt: now })
      .where(and(eq(households.id, id), isNull(households.deletedAt)))
      .returning();
    if (row) await writeHistory(tx, 'household', row.id, 'delete', row, actor);
    return row ?? null;
  });
}
