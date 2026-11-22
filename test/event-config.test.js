import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadEventConfigs, parseEventConfig } from '../src/core/event-config.js';
import { surveyState } from '../src/core/survey-state.js';
import { tempDir } from './helpers.js';

const FILE = 'config/events/pongal-2027.yaml';
const source = readFileSync(FILE, 'utf8');

describe('event config', () => {
  it('Valid event file', () => {
    const [event] = loadEventConfigs('config/events');
    expect(event.config.slug).toBe('pongal-2027');
    expect(event.config.timezone).toBe('America/New_York');
    expect(event.config.days).toEqual([
      { date: '2027-01-16', label: 'Saturday, Jan 16' },
      { date: '2027-01-17', label: 'Sunday, Jan 17' },
    ]);
  });

  it('accepts the agreed pongal-2027 values', () => {
    const { config, surveyOpensAt, surveyClosesAt } = parseEventConfig(source, FILE);
    expect(surveyOpensAt.toISOString()).toBe('2026-11-21T01:00:00.000Z');
    expect(surveyClosesAt.toISOString()).toBe('2026-11-25T04:59:00.000Z');
    expect(config.survey.likelihood_weights).toEqual({ definitely: 1, likely: 0.75, maybe: 0.4 });
    expect(config.survey.headcount_bands.map((b) => b.code)).toEqual(['adult_11_plus', 'kids_5_10', 'kids_under_5']);
    expect(config.survey.volunteer_roles.map((r) => r.code)).toEqual([
      'culturals', 'food_serving', 'stage_setup', 'hosting', 'decoration', 'registration_desk', 'photography', 'cleanup',
    ]);
    expect(config.survey.cultural_options.map((o) => o.code)).toEqual(['yes', 'maybe', 'no']);
    expect(config.survey.max_total_people).toBe(15);
    expect(config.survey.comments_max).toBe(500);
  });

  it('Close before open', () => {
    const bad = source
      .replace('opens_at: 2026-11-20T20:00', 'opens_at: 2026-11-24T23:59')
      .replace('closes_at: 2026-11-24T23:59', 'closes_at: 2026-11-20T20:00');
    expect(() => parseEventConfig(bad, FILE)).toThrow(`${FILE}: survey.closes_at must be after survey.opens_at`);
  });

  it('Unknown timezone', () => {
    const bad = source.replace('timezone: America/New_York', 'timezone: America/Chennai');
    expect(() => parseEventConfig(bad, FILE)).toThrow(`${FILE}: timezone 'America/Chennai' is not a valid IANA timezone`);
  });

  it('Duplicate slug', () => {
    const dir = tempDir();
    writeFileSync(path.join(dir, 'a.yaml'), source);
    writeFileSync(path.join(dir, 'b.yaml'), source);
    expect(() => loadEventConfigs(dir, 'config/events')).toThrow(
      "Duplicate event slug 'pongal-2027' in config/events/a.yaml and config/events/b.yaml",
    );
  });

  it('Duplicate option code', () => {
    const bad = source.replace('- { code: photography, label: "Photography" }', '- { code: cleanup, label: "Photography" }');
    expect(() => parseEventConfig(bad, FILE)).toThrow(`${FILE}: duplicate code 'cleanup' in survey.volunteer_roles`);
  });
});

describe('surveyState', () => {
  const { surveyOpensAt, surveyClosesAt } = parseEventConfig(source, FILE);
  const event = { surveyOpensAt, surveyClosesAt };

  it('Before opening', () => {
    expect(surveyState(event, new Date('2026-11-21T00:59:00Z'))).toBe('not_open');
  });

  it('Open', () => {
    expect(surveyState(event, new Date('2026-11-21T01:00:00Z'))).toBe('open');
  });

  it('Closed at exact close time', () => {
    expect(surveyState(event, new Date('2026-11-25T04:58:59Z'))).toBe('open');
    expect(surveyState(event, new Date('2026-11-25T04:59:00Z'))).toBe('closed');
  });
});
