import { eq, sql } from 'drizzle-orm';
import { eventDays, events } from './schema/index.js';
import { inTransaction, writeHistory } from './history.js';

/** Creates or updates each configured event by slug; unchanged configs (same hash) are skipped. */
export async function seedEvents(db, eventConfigs, logger = console) {
  for (const { config, hash, surveyOpensAt, surveyClosesAt } of eventConfigs) {
    await inTransaction(db, async (tx) => {
      const [existing] = await tx.select().from(events).where(eq(events.slug, config.slug));
      if (existing?.configHash === hash) return;

      const values = {
        name: config.name,
        timezone: config.timezone,
        surveyOpensAt,
        surveyClosesAt,
        configSnapshot: config,
        configHash: hash,
      };
      let row;
      if (existing) {
        [row] = await tx
          .update(events)
          .set({ ...values, updatedAt: new Date() })
          .where(eq(events.id, existing.id))
          .returning();
      } else {
        [row] = await tx.insert(events).values({ slug: config.slug, ...values }).returning();
      }

      // Days removed from the file are kept so anything linked to them stays intact.
      for (const [sort, day] of config.days.entries()) {
        await tx
          .insert(eventDays)
          .values({ eventId: row.id, dayDate: day.date, label: day.label, sort })
          .onConflictDoUpdate({
            target: [eventDays.eventId, eventDays.dayDate],
            set: { label: sql`excluded.label`, sort: sql`excluded.sort` },
          });
      }
      const days = await tx.select().from(eventDays).where(eq(eventDays.eventId, row.id)).orderBy(eventDays.sort);
      const action = existing ? 'update' : 'create';
      await writeHistory(tx, 'event', row.id, action, { ...row, days }, 'system');
      logger.info(`Event '${config.slug}' ${action}d from config`);
    });
  }
}
