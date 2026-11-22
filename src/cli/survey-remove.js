// Stop-gap until admin moderation: soft-deletes one household's active response.
// Usage: npm run survey:remove -- <event-slug> <email>
import { pathToFileURL } from 'node:url';
import { loadConfig } from '../config.js';
import { createDatabase } from '../db/index.js';
import { findEventBySlug } from '../modules/survey/repo.js';
import { removeResponse } from '../modules/survey/service.js';

/** Returns the process exit code. `out` receives user-facing lines. */
export async function run(args, { db, out = console }) {
  const [slug, email] = args;
  if (!slug || !email) {
    out.error('Usage: npm run survey:remove -- <event-slug> <email>');
    return 2;
  }
  const event = await findEventBySlug(db, slug);
  if (!event) {
    out.error(`Unknown event '${slug}'.`);
    return 1;
  }
  const removed = await removeResponse(db, { event, email, actor: 'system' });
  if (!removed) {
    out.error(`No active response for that email in '${slug}'.`);
    return 1;
  }
  out.log(`Removed response ${removed.id} from '${slug}'.`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const database = await createDatabase(loadConfig(), { info() {}, warn() {}, error: console.error });
  let code = 1;
  try {
    code = await run(process.argv.slice(2), { db: database.db });
  } finally {
    await database.close();
  }
  process.exit(code);
}
