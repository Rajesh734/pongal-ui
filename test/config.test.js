import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { buildApp } from '../src/server.js';
import { captureStream, tempDir } from './helpers.js';

const BASE = { DB_DRIVER: 'pglite', EDIT_TOKEN_KEY: 'plain-key' };

function secretFile(contents) {
  const file = path.join(tempDir(), 'secret');
  writeFileSync(file, contents);
  return file;
}

describe('config', () => {
  it('Secret read from file', () => {
    const config = loadConfig({ DB_DRIVER: 'pglite', EDIT_TOKEN_KEY_FILE: secretFile('k3y-value\n') });
    expect(config.EDIT_TOKEN_KEY).toBe('k3y-value');
  });

  it('File value wins over plain variable', () => {
    const config = loadConfig({ ...BASE, TURNSTILE_SECRET: 'from-env', TURNSTILE_SECRET_FILE: secretFile('from-file') });
    expect(config.TURNSTILE_SECRET).toBe('from-file');
  });

  it('Secret file missing', () => {
    expect(() => loadConfig({ DB_DRIVER: 'pglite', EDIT_TOKEN_KEY_FILE: '/run/secrets/missing' })).toThrow(
      'Cannot read secret file for EDIT_TOKEN_KEY: /run/secrets/missing',
    );
  });

  it('Missing required secret', () => {
    expect(() => loadConfig({ DB_DRIVER: 'pglite' })).toThrow(
      'Missing required setting: EDIT_TOKEN_KEY (set EDIT_TOKEN_KEY or EDIT_TOKEN_KEY_FILE)',
    );
  });

  it('Empty secret file for an optional setting', async () => {
    for (const contents of ['', '\n']) {
      const config = loadConfig({ ...BASE, SMTP_PASS_FILE: secretFile(contents) });
      expect(config.SMTP_PASS).toBeUndefined();
      const logs = captureStream();
      const app = await buildApp(config, { database: { ping: async () => {} }, logStream: logs.stream, logLevel: 'info' });
      await app.close();
      expect(logs.text()).toContain('SMTP_PASS: [not set]');
    }
  });

  it('Empty secret file for a required setting', () => {
    expect(() => loadConfig({ DB_DRIVER: 'pglite', EDIT_TOKEN_KEY_FILE: secretFile('') })).toThrow(
      'Missing required setting: EDIT_TOKEN_KEY (set EDIT_TOKEN_KEY or EDIT_TOKEN_KEY_FILE)',
    );
  });

  it('Invalid port', () => {
    expect(() => loadConfig({ ...BASE, PORT: 'abc' })).toThrow(
      'Invalid setting PORT: must be a whole number between 1 and 65535',
    );
    expect(() => loadConfig({ ...BASE, PORT: '70000' })).toThrow('Invalid setting PORT');
  });

  it('Public application URL must use HTTP or HTTPS', () => {
    expect(loadConfig({ ...BASE, APP_BASE_URL: 'https://portal.example.org' }).APP_BASE_URL).toBe('https://portal.example.org');
    expect(() => loadConfig({ ...BASE, APP_BASE_URL: 'ftp://portal.example.org' })).toThrow('Invalid setting APP_BASE_URL');
  });

  it('applies defaults', () => {
    const config = loadConfig(BASE);
    expect(config.PORT).toBe(3000);
    expect(config.NODE_ENV).toBe('development');
  });

  it('exits with code 1 and names the setting on startup failure', () => {
    const result = spawnSync(process.execPath, ['src/server.js'], {
      env: { PATH: process.env.PATH, PORT: 'abc', DB_DRIVER: 'pglite', EDIT_TOKEN_KEY: 'x' },
      encoding: 'utf8',
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Invalid setting PORT: must be a whole number between 1 and 65535');
  });

  it('Startup log', async () => {
    const config = loadConfig({ ...BASE, TURNSTILE_SECRET_FILE: secretFile('0x4AAA-real-secret') });
    const logs = captureStream();
    const app = await buildApp(config, { database: { ping: async () => {} }, logStream: logs.stream, logLevel: 'info' });
    await app.close();
    expect(logs.text()).toContain('TURNSTILE_SECRET: [set]');
    expect(logs.text()).toContain('SMTP_PASS: [not set]');
    expect(logs.text()).not.toContain('0x4AAA-real-secret');
    expect(logs.text()).not.toContain('plain-key');
  });

  it('PostgreSQL 18 NAS settings with password from a secret file', () => {
    const config = loadConfig({
      ...BASE,
      DB_DRIVER: 'postgres',
      DATABASE_HOST: 'kalanjiyam',
      DATABASE_PORT: '5432',
      DATABASE_NAME: 'samugam',
      DATABASE_USER: 'samugam_app',
      DATABASE_PASSWORD_FILE: secretFile('not-a-real-password'),
    });
    expect(config).toMatchObject({
      DB_DRIVER: 'postgres',
      DATABASE_HOST: 'kalanjiyam',
      DATABASE_PORT: 5432,
      DATABASE_NAME: 'samugam',
      DATABASE_USER: 'samugam_app',
      DATABASE_PASSWORD: 'not-a-real-password',
    });
  });

  it('Production requires a dedicated QR pass encryption key', () => {
    expect(() => loadConfig({ ...BASE, NODE_ENV: 'production' })).toThrow(
      'Missing required setting: QR_PASS_ENCRYPTION_KEY (set QR_PASS_ENCRYPTION_KEY or QR_PASS_ENCRYPTION_KEY_FILE)',
    );
    const key = Buffer.alloc(32, 9).toString('base64');
    const config = loadConfig({ ...BASE, NODE_ENV: 'production', QR_PASS_ENCRYPTION_KEY: key });
    expect(config.QR_PASS_ENCRYPTION_KEY).toBe(key);
  });
});
