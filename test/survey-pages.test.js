import { afterEach, describe, expect, it } from 'vitest';
import { removeResponse } from '../src/modules/survey/service.js';
import { findEventBySlug } from '../src/modules/survey/repo.js';
import { validForm } from './helpers.js';
import { AFTER_CLOSE, BEFORE_OPEN, NOV_25, TOKEN_PATH, surveyApp } from './survey-app.js';

const CLOSED = 'The Pongal 2027 interest survey is now closed. Thank you for your interest! Organizers will share next steps soon.';
const INVALID_LINK = 'This edit link isn&#39;t valid anymore. Please use your latest link, or fill in the survey again.';
const html = (s) => s.replace(/'/g, '&#39;').replace(/&(?!#39;)/g, '&amp;');

let ctx;
afterEach(async () => {
  await ctx?.app.close();
  ctx = undefined;
});

async function submitted(overrides, headers) {
  const res = await ctx.submit(overrides, headers);
  expect(res.statusCode).toBe(303);
  return { res, location: res.headers.location, token: res.headers.location.match(TOKEN_PATH)[1] };
}

describe('window states', () => {
  it('Before opening', async () => {
    ctx = await surveyApp();
    ctx.clock.now = BEFORE_OPEN;
    const res = await ctx.app.inject('/s/pongal-2027');
    expect(res.body).toContain('The Pongal 2027 interest survey opens on Friday, November 20 at 8:00 PM ET.');
    expect(res.body).not.toContain('<form');
  });

  it('Open', async () => {
    ctx = await surveyApp();
    const res = await ctx.app.inject('/s/pongal-2027');
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('<form method="post" action="/s/pongal-2027"');
  });

  it('Closed', async () => {
    ctx = await surveyApp();
    ctx.clock.now = NOV_25;
    const res = await ctx.app.inject('/s/pongal-2027');
    expect(res.body).toContain(html(CLOSED));
    expect(res.body).not.toContain('<form');
  });

  it('Unknown event', async () => {
    ctx = await surveyApp();
    const res = await ctx.app.inject('/s/diwali-1999');
    expect(res.statusCode).toBe(404);
    expect(res.body).toContain('Sorry, we couldn&#39;t find that page.');
  });

  it('Root renders the portal Home page', async () => {
    ctx = await surveyApp();
    const { statusCode, body } = await ctx.app.inject('/');
    expect(statusCode).toBe(200);
    expect(body).toContain('<h1>Pongal 2027</h1>');
    expect(body).toContain('href="/register">Register your household</a>');
  });

  it('Home remains available after the interest survey closes', async () => {
    ctx = await surveyApp();
    ctx.clock.now = NOV_25;
    const { statusCode, body } = await ctx.app.inject('/');
    expect(statusCode).toBe(200);
    expect(body).toContain('<h1>Pongal 2027</h1>');
    expect(body).not.toContain('There are no open surveys right now.');
  });
});

describe('form', () => {
  it('Pongal 2027 form', async () => {
    ctx = await surveyApp();
    const { body } = await ctx.app.inject('/s/pongal-2027');
    const labels = [
      'Saturday, Jan 16',
      'Sunday, Jan 17',
      'Adults &amp; kids 11+',
      'Kids 5-10',
      'Kids under 5',
      'Veg',
      'Non-veg',
      'Either is fine',
      'Culturals',
      'Food Serving',
      'Stage Setup',
      'Hosting',
      'Decoration',
      'Registration Desk',
      'Photography',
      'Cleanup',
      '$15',
      '$20',
      '$25',
      'Flexible',
      html("I agree that organizers may contact me by email, phone or WhatsApp about Pongal 2027. My details are visible only to organizers and won't be shared."),
    ];
    for (const label of labels) expect(body, label).toContain(label);
    // Field order from the spec.
    const order = ['name="name"', 'name="email"', 'name="mobile"', 'name="days"', 'name="likelihood_2027-01-16"', 'name="headcount_adult_11_plus"', 'name="food"', 'name="roles"', 'name="cultural"', 'name="contribution"', 'name="comments"', 'name="consent"'];
    const positions = order.map((f) => body.indexOf(f));
    expect(positions.every((p) => p > 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(body).toContain('How likely are you to attend on Sunday, Jan 17?');
    expect(body).toContain('inputmode="numeric" pattern="[0-9]*"');
    expect(body).toContain('type="tel" inputmode="tel" autocomplete="tel-national"');
    expect(body).toContain('type="email" inputmode="email" autocomplete="email"');
  });

  it('Server check with scripts disabled', async () => {
    ctx = await surveyApp();
    const res = await ctx.submit({ name: '', days: undefined, email: 'keep.me@example.com', comments: 'Kept comment' });
    expect(res.statusCode).toBe(400);
    expect(await ctx.count('survey_responses')).toBe(0);
    expect(res.body).toContain('Please fix the 2 highlighted fields below.');
    expect(res.body).toContain('Please enter your name (at least 2 letters).');
    expect(res.body).toContain('Please pick at least one day you could attend.');
    expect(res.body).toContain('value="keep.me@example.com"');
    expect(res.body).toContain('Kept comment</textarea>');
    expect(res.body).toMatch(/value="veg" checked/);
  });

  it('Single error summary', async () => {
    ctx = await surveyApp();
    const res = await ctx.submit({ food: undefined });
    expect(res.body).toContain('Please fix the highlighted field below.');
  });

  it('Submission after closing', async () => {
    ctx = await surveyApp();
    await ctx.app.inject('/s/pongal-2027'); // loaded before closing
    ctx.clock.now = AFTER_CLOSE;
    const res = await ctx.submit();
    expect(await ctx.count('survey_responses')).toBe(0);
    expect(res.body).toContain(html(CLOSED));
  });
});

describe('confirmation', () => {
  it('New response confirmation', async () => {
    ctx = await surveyApp();
    const { location } = await submitted({ roles: ['cleanup', 'hosting'] });
    expect(location).toMatch(/\?saved=new$/);
    const page = await ctx.app.inject(location);
    expect(page.body).toContain(html("Thank you, Priya! Your family's response for Pongal 2027 has been saved."));
    for (const answer of ['priya@example.com', 'Definitely', 'Veg', 'Cleanup, Hosting', 'Maybe', '$20']) expect(page.body).toContain(answer);
  });

  it('Replaced response confirmation', async () => {
    ctx = await surveyApp();
    await submitted({ food: 'veg', comments: 'First answers' });
    const { location } = await submitted({ email: 'PRIYA@example.com', food: 'non_veg' });
    expect(location).toMatch(/\?saved=updated$/);
    const page = await ctx.app.inject(location);
    expect(page.body).toContain(html("Thank you, Priya! We've updated your family's response for Pongal 2027."));
    expect(page.body).toContain('Non-veg');
    expect(page.body).not.toContain('First answers');
  });

  it('Refresh does not resubmit', async () => {
    ctx = await surveyApp();
    const { location } = await submitted();
    await ctx.app.inject(location);
    await ctx.app.inject(location);
    expect(await ctx.count('survey_responses')).toBe(1);
    expect(await ctx.count("change_history where entity_type = 'survey_response'")).toBe(1);
  });

  it('Link on confirmation page', async () => {
    ctx = await surveyApp();
    const { location } = await submitted();
    const page = await ctx.app.inject({ url: location, headers: { host: 'survey.example.org', 'x-forwarded-proto': 'https' } });
    expect(page.body).toMatch(/https:\/\/survey\.example\.org\/s\/pongal-2027\/edit\/[A-Za-z0-9_-]{43}</);
    expect(page.body).toContain('Copy link');
    expect(page.body).toContain('Save this link to change your answers until Tuesday, November 24 at 11:59 PM ET.');
  });
});

describe('edit link', () => {
  it('Pre-filled form', async () => {
    ctx = await surveyApp();
    const { token } = await submitted({ headcount_adult_11_plus: '3', mobile: '617 555 0123' });
    const page = await ctx.app.inject(`/s/pongal-2027/edit/${token}`);
    expect(page.statusCode).toBe(200);
    expect(page.body).toMatch(/name="headcount_adult_11_plus"[^>]*value="3"/);
    expect(page.body).toMatch(/name="likelihood_2027-01-16" value="definitely" checked/);
    expect(page.body).toMatch(/name="food" value="veg" checked/);
    expect(page.body).toContain('value="617-555-0123"');
    expect(page.body).toContain('<p class="readonly" id="email">priya@example.com</p>');
    expect(page.body).not.toContain('name="email"');
    expect(page.body).toContain('To change your email, please contact the organizers.');
  });

  it('Successful edit', async () => {
    ctx = await surveyApp();
    const { token } = await submitted({ headcount_adult_11_plus: '3' });
    const url = `/s/pongal-2027/edit/${token}`;
    const res = await ctx.post(url, validForm({ email: undefined, headcount_adult_11_plus: '4' }));
    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toBe(`${url}?saved=updated`);
    const page = await ctx.app.inject(res.headers.location);
    expect(page.body).toContain(html("Thank you, Priya! We've updated your family's response for Pongal 2027."));
    expect(page.body).toMatch(/<dt>Adults &amp; kids 11\+<\/dt>\s*<dd>4<\/dd>/);
    expect((await ctx.app.inject(url)).statusCode).toBe(200);
  });

  it('Tampered email ignored', async () => {
    ctx = await surveyApp();
    const { token } = await submitted();
    await ctx.post(`/s/pongal-2027/edit/${token}`, validForm({ email: 'other@example.com' }));
    expect(await ctx.count("households where email = 'priya@example.com'")).toBe(1);
    expect(await ctx.count("households where email = 'other@example.com'")).toBe(0);
  });

  it('Invalid edit', async () => {
    ctx = await surveyApp();
    const { token } = await submitted();
    const res = await ctx.post(`/s/pongal-2027/edit/${token}`, validForm({ days: undefined }));
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('Please pick at least one day you could attend.');
    expect(await ctx.count("change_history where entity_type = 'survey_response'")).toBe(1);
  });

  it('Older link replaced', async () => {
    ctx = await surveyApp();
    const a = await submitted();
    const b = await submitted();
    expect((await ctx.app.inject(`/s/pongal-2027/edit/${a.token}`)).statusCode).toBe(404);
    expect((await ctx.app.inject(`/s/pongal-2027/edit/${b.token}`)).statusCode).toBe(200);
  });

  it('Replaced link', async () => {
    ctx = await surveyApp();
    const a = await submitted();
    await submitted();
    const res = await ctx.app.inject(`/s/pongal-2027/edit/${a.token}`);
    expect(res.statusCode).toBe(404);
    expect(res.body).toContain(INVALID_LINK);
    expect(res.body).toContain('href="/s/pongal-2027"');
    const post = await ctx.post(`/s/pongal-2027/edit/${a.token}`, validForm());
    expect(post.statusCode).toBe(404);
  });

  it('Removed response', async () => {
    ctx = await surveyApp();
    const { token } = await submitted();
    const event = await findEventBySlug(ctx.db, 'pongal-2027');
    await removeResponse(ctx.db, { event, email: 'priya@example.com' });
    const res = await ctx.app.inject(`/s/pongal-2027/edit/${token}`);
    expect(res.statusCode).toBe(404);
    expect(res.body).toContain(INVALID_LINK);
  });

  it('Malformed token', async () => {
    ctx = await surveyApp();
    for (const bad of ['short', `${'a'.repeat(42)}!`, 'a'.repeat(44)]) {
      const res = await ctx.app.inject(`/s/pongal-2027/edit/${encodeURIComponent(bad)}`);
      expect(res.statusCode, bad).toBe(404);
      expect(res.body).toContain(INVALID_LINK);
    }
  });

  it('Open after close', async () => {
    ctx = await surveyApp();
    const { token } = await submitted({ comments: 'Secret answer' });
    ctx.clock.now = NOV_25;
    const page = await ctx.app.inject(`/s/pongal-2027/edit/${token}?saved=new`);
    expect(page.body).toContain(html(CLOSED));
    expect(page.body).not.toContain('Secret answer');
    expect(page.body).not.toContain('priya@example.com');
    const post = await ctx.post(`/s/pongal-2027/edit/${token}`, validForm({ comments: 'Changed' }));
    expect(post.body).toContain(html(CLOSED));
    expect(await ctx.count("change_history where entity_type = 'survey_response'")).toBe(1);
  });
});
