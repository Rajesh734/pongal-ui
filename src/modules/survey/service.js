import { inTransaction, writeHistory } from '../../db/history.js';
import {
  findActiveResponse,
  insertResponse,
  replaceChildren,
  softDeleteResponse,
  updateHousehold,
  updateResponse,
  upsertHousehold,
  writeResponseHistory,
} from './repo.js';
import { generateToken, hashToken } from './tokens.js';

const ACTOR = 'public';

function isActiveResponseConflict(err) {
  for (let e = err; e; e = e.cause) {
    if (e.code === '23505' && (e.constraint === 'ux_response_active' || String(e.message).includes('ux_response_active'))) return true;
  }
  return false;
}

/**
 * Saves a public-form submission (design D5): one active response per household per event, a new edit token
 * on every save. Returns { token, response, household, created } where `created` is true for a new response.
 */
export async function saveFromPublicForm(db, { event, data, tokenKey, now = new Date() }) {
  const attempt = () =>
    inTransaction(db, async (tx) => {
      const { household, created: householdCreated } = await upsertHousehold(tx, data, now);
      await writeHistory(tx, 'household', household.id, householdCreated ? 'create' : 'update', household, ACTOR);

      const token = generateToken();
      const tokenHash = hashToken(tokenKey, token);
      const existing = await findActiveResponse(tx, event.id, household.id);
      const response = existing
        ? await updateResponse(tx, existing.id, { data, tokenHash, now })
        : await insertResponse(tx, { eventId: event.id, householdId: household.id, data, tokenHash, now });
      await replaceChildren(tx, response.id, event, data);
      await writeResponseHistory(tx, response, existing ? 'update' : 'create', ACTOR);
      return { token, response, household, created: !existing };
    });

  try {
    return await attempt();
  } catch (err) {
    // Two saves for the same new household raced on different connections; the retry takes the update path.
    if (!isActiveResponseConflict(err)) throw err;
    return attempt();
  }
}

/** Saves through an edit link: same token kept, household email unchanged (any submitted email is ignored). */
export function saveFromEditLink(db, { event, response, household, data, now = new Date() }) {
  return inTransaction(db, async (tx) => {
    const updatedHousehold = await updateHousehold(tx, household.id, data, now);
    await writeHistory(tx, 'household', household.id, 'update', updatedHousehold, ACTOR);
    const updated = await updateResponse(tx, response.id, { data, now });
    await replaceChildren(tx, updated.id, event, data);
    await writeResponseHistory(tx, updated, 'update', ACTOR);
    return { response: updated, household: updatedHousehold, created: false };
  });
}

export function removeResponse(db, { event, email, actor = 'system', now = new Date() }) {
  return inTransaction(db, (tx) => softDeleteResponse(tx, event.id, email, actor, now));
}
