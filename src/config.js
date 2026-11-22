import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { ConfigError } from './core/errors.js';

const SECRETS = ['DATABASE_PASSWORD', 'EDIT_TOKEN_KEY', 'TURNSTILE_SECRET', 'SMTP_PASS'];

const PORT_MESSAGE = 'must be a whole number between 1 and 65535';
const port = z
  .string()
  .regex(/^\d+$/, PORT_MESSAGE)
  .transform(Number)
  .refine((n) => n >= 1 && n <= 65535, PORT_MESSAGE);

const text = z.string().min(1);

const base = z.object({
  PORT: port.default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DB_DRIVER: z.enum(['pglite', 'postgres']),
  PGLITE_DATA_DIR: text.optional(),
  DATABASE_HOST: text.optional(),
  DATABASE_PORT: port.default(5432),
  DATABASE_NAME: text.optional(),
  DATABASE_USER: text.optional(),
  DATABASE_PASSWORD: text.optional(),
  BACKUP_DIR: text.optional(),
  EDIT_TOKEN_KEY: text,
  TURNSTILE_SITE_KEY: text.optional(),
  TURNSTILE_SECRET: text.optional(),
  SMTP_HOST: text.optional(),
  SMTP_PORT: port.optional(),
  SMTP_USER: text.optional(),
  SMTP_FROM: text.optional(),
  SMTP_PASS: text.optional(),
  CF_ACCESS_TEAM_DOMAIN: text.optional(),
  CF_ACCESS_AUD: text.optional(),
});

const schema = base.superRefine((cfg, ctx) => {
  if (cfg.DB_DRIVER !== 'postgres') return;
  for (const key of ['DATABASE_HOST', 'DATABASE_NAME', 'DATABASE_USER', 'DATABASE_PASSWORD']) {
    if (!cfg[key]) ctx.addIssue({ code: 'custom', path: [key], message: 'required' });
  }
});

const NAMES = Object.keys(base.shape);

function resolve(env, name) {
  const file = env[`${name}_FILE`];
  if (file) {
    let value;
    try {
      value = readFileSync(file, 'utf8').trim();
    } catch {
      throw new ConfigError(`Cannot read secret file for ${name}: ${file}`);
    }
    return value === '' ? undefined : value;
  }
  const value = env[name];
  return value === undefined || value === '' ? undefined : value;
}

function describeIssue(issue, raw) {
  const key = String(issue.path[0]);
  if (raw[key] === undefined) return `Missing required setting: ${key} (set ${key} or ${key}_FILE)`;
  if (key === 'DB_DRIVER') return `Unsupported DB_DRIVER '${raw[key]}'. Use 'pglite' or 'postgres'.`;
  return `Invalid setting ${key}: ${issue.message}`;
}

export function loadConfig(env = process.env) {
  const raw = {};
  for (const name of NAMES) raw[name] = resolve(env, name);
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new ConfigError(result.error.issues.map((issue) => describeIssue(issue, raw)).join('\n'));
  }
  return Object.freeze(result.data);
}

export function formatConfig(config) {
  const parts = NAMES.map((name) => {
    const value = config[name];
    if (SECRETS.includes(name)) return `${name}: ${value ? '[set]' : '[not set]'}`;
    return `${name}: ${value ?? '[not set]'}`;
  });
  return `Effective configuration: ${parts.join(', ')}`;
}
