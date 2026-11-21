import { existsSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nextBackupTime, runBackup, scheduleBackups } from '../src/core/backup.js';
import { createDatabase } from '../src/db/index.js';
import { recordingLogger, silentLogger, tempDir, testConfig } from './helpers.js';

const fakeClient = { dumpDataDir: async () => new Blob([Buffer.from('fake-tarball')]) };

afterEach(() => vi.useRealTimers());

describe('nightly backup', () => {
  it('schedules the next 02:00 in event time', () => {
    expect(nextBackupTime(new Date('2026-11-21T01:00:00Z')).toISOString()).toBe('2026-11-21T07:00:00.000Z');
    expect(nextBackupTime(new Date('2026-11-21T07:00:00Z')).toISOString()).toBe('2026-11-22T07:00:00.000Z');
  });

  it('Daily backup written', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-21T00:00:00Z') });
    const dir = path.join(tempDir(), 'backups');
    const logger = recordingLogger();
    const job = scheduleBackups({ client: fakeClient, dir, logger });

    await vi.advanceTimersByTimeAsync(7 * 60 * 60 * 1000 - 1000);
    expect(existsSync(dir) ? readdirSync(dir) : []).toEqual([]);

    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => expect(readdirSync(dir)).toEqual(['pglite-2026-11-21.tar.gz']));
    job.stop();
  });

  it('Retention', async () => {
    const dir = tempDir();
    for (let day = 1; day <= 14; day++) {
      writeFileSync(path.join(dir, `pglite-2026-11-${String(day).padStart(2, '0')}.tar.gz`), 'old');
    }
    await runBackup({ client: fakeClient, dir, now: new Date('2026-11-21T07:00:00Z'), logger: recordingLogger() });
    const files = readdirSync(dir).sort();
    expect(files).toHaveLength(14);
    expect(files).not.toContain('pglite-2026-11-01.tar.gz');
    expect(files).toContain('pglite-2026-11-21.tar.gz');
  });

  it('Backup fails', async () => {
    const logger = recordingLogger();
    const failing = { dumpDataDir: async () => Promise.reject(new Error('ENOSPC: no space left on device')) };
    await expect(runBackup({ client: failing, dir: tempDir(), logger })).resolves.toBeUndefined();
    expect(logger.lines).toContainEqual({ level: 'error', msg: 'Nightly backup failed: ENOSPC: no space left on device' });
  });

  it('dumps a real PGlite data folder', async () => {
    const database = await createDatabase(testConfig({ PGLITE_DATA_DIR: path.join(tempDir(), 'pglite') }), silentLogger);
    await database.migrate();
    const dir = tempDir();
    await runBackup({ client: database.client, dir, now: new Date('2026-11-21T07:00:00Z'), logger: recordingLogger() });
    await database.close();
    expect(statSync(path.join(dir, 'pglite-2026-11-21.tar.gz')).size).toBeGreaterThan(0);
  });
});
