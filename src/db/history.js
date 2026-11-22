import { changeHistory } from './schema/index.js';

export function inTransaction(db, fn) {
  return db.transaction(fn);
}

export async function writeHistory(tx, entityType, entityId, action, snapshot, actor) {
  await tx.insert(changeHistory).values({ entityType, entityId: String(entityId), action, snapshot, actor });
}
