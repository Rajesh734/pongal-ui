import { mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { dateInZone, DEFAULT_TIMEZONE, localToUtc } from './time.js';

const BACKUP_FILE = /^pglite-\d{4}-\d{2}-\d{2}\.tar\.gz$/;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Next 02:00 (local to `timeZone`) strictly after `now`. */
export function nextBackupTime(now, timeZone = DEFAULT_TIMEZONE, hour = 2) {
  const at = (date) => localToUtc(`${date}T${String(hour).padStart(2, '0')}:00`, timeZone);
  const today = at(dateInZone(now, timeZone));
  if (today > now) return today;
  return at(dateInZone(new Date(now.getTime() + DAY_MS), timeZone));
}

export async function runBackup({ client, dir, now = new Date(), timeZone = DEFAULT_TIMEZONE, keep = 14, logger }) {
  try {
    await mkdir(dir, { recursive: true });
    const name = `pglite-${dateInZone(now, timeZone)}.tar.gz`;
    const blob = await client.dumpDataDir('gzip');
    const tmp = path.join(dir, `${name}.tmp`);
    await writeFile(tmp, Buffer.from(await blob.arrayBuffer()));
    await rename(tmp, path.join(dir, name));

    const backups = (await readdir(dir)).filter((n) => BACKUP_FILE.test(n)).sort();
    for (const old of backups.slice(0, Math.max(0, backups.length - keep))) {
      await rm(path.join(dir, old));
    }
    logger.info(`Nightly backup written: ${name}`);
  } catch (err) {
    logger.error(`Nightly backup failed: ${err.message}`);
  }
}

/** Schedules runBackup every day at 02:00 event time. Returns { stop() }. */
export function scheduleBackups({ client, dir, timeZone = DEFAULT_TIMEZONE, logger, clock = () => new Date() }) {
  let timer;
  const plan = () => {
    const delay = nextBackupTime(clock(), timeZone).getTime() - clock().getTime();
    timer = setTimeout(async () => {
      await runBackup({ client, dir, now: clock(), timeZone, logger });
      plan();
    }, delay);
    timer.unref?.();
  };
  plan();
  return { stop: () => clearTimeout(timer) };
}
