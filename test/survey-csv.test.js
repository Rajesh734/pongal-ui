import { afterEach, describe, expect, it } from 'vitest';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { findEventBySlug, softDeleteResponse } from '../src/modules/survey/repo.js';
import { csvCell, formatPhone } from '../src/core/csv.js';
import { surveyApp } from './survey-app.js';

const TEAM_DOMAIN = 'organizers.example.cloudflareaccess.com';
const AUDIENCE = 'pongal-admin-aud';

let ctx;
afterEach(async () => {
  await ctx?.app.close();
  ctx = undefined;
});

async function setup() {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k', alg: 'RS256', use: 'sig' };
  const token = await new SignJWT({ email: 'organizer@example.com' })
    .setProtectedHeader({ alg: 'RS256', kid: 'k' })
    .setIssuer(`https://${TEAM_DOMAIN}`)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(privateKey);
  ctx = await surveyApp({
    config: { CF_ACCESS_TEAM_DOMAIN: TEAM_DOMAIN, CF_ACCESS_AUD: AUDIENCE },
    jwks: createLocalJWKSet({ keys: [jwk] }),
  });
  ctx.headers = { 'cf-access-jwt-assertion': token };
  ctx.download = (slug = 'pongal-2027') => ctx.app.inject({ url: `/admin/events/${slug}/responses.csv`, headers: ctx.headers });
}

describe('csv helpers', () => {
  it('guards formulas but keeps validated phone numbers', () => {
    expect(csvCell('=HYPERLINK("http://evil.example","Click")')).toBe('"\'=HYPERLINK(""http://evil.example"",""Click"")"');
    expect(csvCell('- veg only please')).toBe('"\'- veg only please"');
    expect(csvCell('+16175550123')).toBe('"+16175550123"');
    expect(csvCell('+1 (not a phone)')).toBe('"\'+1 (not a phone)"');
    expect(csvCell('We\'ll bring "kolam" supplies,\nthanks')).toBe('"We\'ll bring ""kolam"" supplies,\nthanks"');
  });

  it('formats US numbers as 617-555-0123 and leaves others', () => {
    expect(formatPhone('+16175550123')).toBe('617-555-0123');
    expect(formatPhone('+447911123456')).toBe('+447911123456');
    expect(formatPhone(null)).toBe('');
  });
});

describe('survey CSV download', () => {
  it('returns a spreadsheet-safe file with one row per active response', async () => {
    await setup();
    await ctx.submit({
      name: 'பிரியா Raman',
      email: 'priya@example.com',
      mobile: '617-555-0123',
      days: ['2027-01-16', '2027-01-17'],
      'likelihood_2027-01-16': 'definitely',
      'likelihood_2027-01-17': 'maybe',
      headcount_adult_11_plus: '2',
      headcount_kids_5_10: '1',
      headcount_kids_under_5: '1',
      roles: ['food_serving', 'cleanup'],
      cultural: 'yes',
      comments: '=HYPERLINK("http://evil.example","Click")',
    });
    await ctx.submit({ name: 'Removed Family', email: 'gone@example.com' });
    const event = await findEventBySlug(ctx.db, 'pongal-2027');
    await softDeleteResponse(ctx.db, event.id, 'gone@example.com', 'test');

    const response = await ctx.download();
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/csv; charset=utf-8');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['content-disposition']).toMatch(/^attachment; filename="pongal-2027-responses-\d{4}-\d{2}-\d{2}-\d{4}\.csv"$/);
    expect(response.body.startsWith('\uFEFF')).toBe(true);

    const lines = response.body.split('\r\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe('\uFEFF' + [
      'Submitted (ET)', 'Last updated (ET)', 'Name', 'Email', 'Mobile', 'Saturday, Jan 16', 'Sunday, Jan 17',
      'Adults & kids 11+', 'Kids 5-10', 'Kids under 5', 'Total people', 'Weighted Saturday, Jan 16', 'Weighted Sunday, Jan 17',
      'Food', 'Volunteer roles', 'Cultural performance', 'Contribution per adult', 'Comments',
    ].map((c) => `"${c}"`).join(','));
    expect(lines[1]).toContain('"பிரியா Raman","priya@example.com","617-555-0123","Definitely","Maybe","2","1","1","4","4.00","1.60","Veg","Food Serving; Cleanup","Yes","$20"');
    expect(lines[1]).toContain('"\'=HYPERLINK(');
  });

  it('shows an empty day as blank and weighted 0.00', async () => {
    await setup();
    await ctx.submit({ days: ['2027-01-17'], 'likelihood_2027-01-17': 'likely', headcount_adult_11_plus: '4', headcount_kids_5_10: '0' });
    const [, row] = (await ctx.download()).body.split('\r\n');
    expect(row).toContain('"","Likely","4","0","0","4","0.00","3.00"');
  });

  it('returns only the header before anyone responds, and 404 for an unknown event', async () => {
    await setup();
    expect((await ctx.download()).body.split('\r\n')).toHaveLength(1);
    const missing = await ctx.download('diwali-1999');
    expect(missing.statusCode).toBe(404);
    expect(missing.body).toContain("Sorry, we couldn&#39;t find that page.");
  });

  it('denies a request without an organizer token', async () => {
    await setup();
    expect((await ctx.app.inject('/admin/events/pongal-2027/responses.csv')).statusCode).toBe(403);
  });
});
