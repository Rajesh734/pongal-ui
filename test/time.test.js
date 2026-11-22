import { describe, expect, it } from 'vitest';
import { dateInZone, formatInZone, localToUtc } from '../src/core/time.js';

describe('time', () => {
  it('Display in event timezone', () => {
    expect(formatInZone(new Date('2026-11-21T01:30:00Z'), 'America/New_York')).toBe('Fri, Nov 20, 8:30 PM ET');
  });

  it('converts local event time to UTC across DST', () => {
    expect(localToUtc('2026-11-20T20:00', 'America/New_York').toISOString()).toBe('2026-11-21T01:00:00.000Z');
    expect(localToUtc('2026-07-04T20:00', 'America/New_York').toISOString()).toBe('2026-07-05T00:00:00.000Z');
  });

  it('gives the calendar date in the event timezone', () => {
    expect(dateInZone(new Date('2026-11-21T03:00:00Z'), 'America/New_York')).toBe('2026-11-20');
  });
});
