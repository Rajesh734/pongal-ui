import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { ConfigError } from '../core/errors.js';

export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../drizzle', import.meta.url));

async function openPglite(config, logger) {
  const { PGlite } = await import('@electric-sql/pglite');
  const { citext } = await import('@electric-sql/pglite/contrib/citext');
  const { drizzle } = await import('drizzle-orm/pglite');
  const { migrate } = await import('drizzle-orm/pglite/migrator');

  const dataDir = config.PGLITE_DATA_DIR;
  if (dataDir) {
    mkdirSync(dataDir, { recursive: true });
    logger.info(`PGlite data folder: ${dataDir}`);
  } else {
    logger.warn('PGlite running in memory - data will not be kept');
  }
  const client = new PGlite({ ...(dataDir ? { dataDir } : {}), extensions: { citext } });
  await client.waitReady;
  const db = drizzle(client);
  return { driver: 'pglite', db, client, migrate: (folder) => migrate(db, { migrationsFolder: folder }), close: () => client.close() };
}

async function openPostgres(config) {
  const { default: pg } = await import('pg');
  const { drizzle } = await import('drizzle-orm/node-postgres');
  const { migrate } = await import('drizzle-orm/node-postgres/migrator');

  const client = new pg.Pool({
    host: config.DATABASE_HOST,
    port: config.DATABASE_PORT,
    database: config.DATABASE_NAME,
    user: config.DATABASE_USER,
    password: config.DATABASE_PASSWORD,
    max: 5,
  });
  const db = drizzle(client);
  return { driver: 'postgres', db, client, migrate: (folder) => migrate(db, { migrationsFolder: folder }), close: () => client.end() };
}

/** Returns { driver, db, client, ping(), migrate(folder?), close() } for the configured driver. */
export async function createDatabase(config, logger = console) {
  let handle;
  if (config.DB_DRIVER === 'pglite') handle = await openPglite(config, logger);
  else if (config.DB_DRIVER === 'postgres') handle = await openPostgres(config);
  else throw new ConfigError(`Unsupported DB_DRIVER '${config.DB_DRIVER}'. Use 'pglite' or 'postgres'.`);

  const runMigrations = handle.migrate;
  return {
    ...handle,
    ping: () => handle.db.execute(sql`select 1`),
    migrate: (folder = MIGRATIONS_FOLDER) => runMigrations(folder),
  };
}
