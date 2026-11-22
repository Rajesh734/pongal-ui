import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';
import { ConfigError } from './errors.js';
import { isValidTimeZone, localToUtc } from './time.js';

const code = z.string().regex(/^[a-z0-9_]+$/, 'must use lower-case letters, digits and _');
const option = z.object({ code, label: z.string().min(1) });
const options = z.array(option).min(1);
const localDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'must look like 2026-11-20T20:00');
const weight = z.number().min(0).max(1);
const count = z.number().int().min(0);

const CODE_LISTS = ['headcount_bands', 'food_options', 'volunteer_roles', 'cultural_options', 'contribution_options'];

export const eventConfigSchema = z
  .object({
    slug: z.string().regex(/^[a-z0-9-]+$/, 'must use lower-case letters, digits and -'),
    name: z.string().min(1),
    timezone: z.string().min(1),
    days: z
      .array(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must look like 2027-01-16'), label: z.string().min(1) }))
      .min(1),
    survey: z.object({
      opens_at: localDateTime,
      closes_at: localDateTime,
      closed_message: z.string().min(1),
      likelihood_weights: z.object({ definitely: weight, likely: weight, maybe: weight }),
      headcount_bands: z
        .array(option.extend({ min: count, max: count, price_tier: z.enum(['full', 'reduced', 'free']) }))
        .min(1),
      max_total_people: z.number().int().positive(),
      food_options: options,
      volunteer_roles: options,
      cultural_options: options,
      contribution_options: options,
      comments_max: z.number().int().positive(),
    }),
  })
  .superRefine((cfg, ctx) => {
    if (!isValidTimeZone(cfg.timezone)) {
      ctx.addIssue({ code: 'custom', path: [], message: `timezone '${cfg.timezone}' is not a valid IANA timezone` });
      return;
    }
    const opens = localToUtc(cfg.survey.opens_at, cfg.timezone);
    const closes = localToUtc(cfg.survey.closes_at, cfg.timezone);
    if (closes <= opens) {
      ctx.addIssue({ code: 'custom', path: [], message: 'survey.closes_at must be after survey.opens_at' });
    }
    for (const list of CODE_LISTS) {
      const seen = new Set();
      for (const { code: c } of cfg.survey[list]) {
        if (seen.has(c)) ctx.addIssue({ code: 'custom', path: [], message: `duplicate code '${c}' in survey.${list}` });
        seen.add(c);
      }
    }
  });

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function parseEventConfig(source, file) {
  let data;
  try {
    data = parse(source);
  } catch (err) {
    throw new ConfigError(`${file}: ${err.message}`);
  }
  const result = eventConfigSchema.safeParse(data);
  if (!result.success) {
    const lines = result.error.issues.map((i) => (i.path.length ? `${file}: ${i.path.join('.')} ${i.message}` : `${file}: ${i.message}`));
    throw new ConfigError(lines.join('\n'));
  }
  const config = result.data;
  return {
    file,
    config,
    hash: createHash('sha256').update(stableStringify(config)).digest('hex'),
    surveyOpensAt: localToUtc(config.survey.opens_at, config.timezone),
    surveyClosesAt: localToUtc(config.survey.closes_at, config.timezone),
  };
}

/** Loads and validates every *.yaml file in `dir`; `displayDir` is used in messages. */
export function loadEventConfigs(dir = 'config/events', displayDir = dir) {
  const names = readdirSync(dir)
    .filter((n) => n.endsWith('.yaml'))
    .sort();
  const bySlug = new Map();
  const events = [];
  for (const name of names) {
    const file = path.posix.join(displayDir, name);
    const event = parseEventConfig(readFileSync(path.join(dir, name), 'utf8'), file);
    const other = bySlug.get(event.config.slug);
    if (other) throw new ConfigError(`Duplicate event slug '${event.config.slug}' in ${other} and ${file}`);
    bySlug.set(event.config.slug, file);
    events.push(event);
  }
  return events;
}
