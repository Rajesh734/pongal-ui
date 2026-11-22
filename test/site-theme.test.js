import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseEventConfig } from '../src/core/event-config.js';
import { findLogo } from '../src/core/site.js';
import { seedEvents } from '../src/db/seed-events.js';
import { silentLogger, tempDir } from './helpers.js';
import { NOV_25, surveyApp, TOKEN_PATH } from './survey-app.js';

const GREETING = 'இனிய பொங்கல் நல்வாழ்த்துக்கள்';
const HERO = 'src/public/img/pongal-hero.webp';

let ctx;
afterEach(async () => {
  await ctx?.app.close();
  ctx = undefined;
});

const headerOf = (body) => body.slice(body.indexOf('<header class="site-header"'), body.indexOf('</header>'));

describe('site header', () => {
  it('No logo yet', async () => {
    ctx = await surveyApp({ imgDir: tempDir() });
    const header = headerOf((await ctx.app.inject('/s/pongal-2027')).body);
    expect(header).toContain('Eastcoast Tamil Community');
    expect(header).toContain('New Hampshire, USA');
    expect(header).not.toContain('<img');
  });

  it('Logo added', async () => {
    const dir = tempDir();
    writeFileSync(path.join(dir, 'logo.png'), 'png');
    ctx = await surveyApp({ imgDir: dir });
    const header = headerOf((await ctx.app.inject('/s/pongal-2027')).body);
    expect(header).toMatch(/<img class="site-logo" src="\/public\/img\/logo.png" alt="Eastcoast Tamil Community logo"/);
    expect(header.indexOf('<img')).toBeLessThan(header.indexOf('site-name'));
    expect(header).toContain('New Hampshire, USA');
  });

  it('Both formats present', async () => {
    const dir = tempDir();
    writeFileSync(path.join(dir, 'logo.png'), 'png');
    writeFileSync(path.join(dir, 'logo.svg'), '<svg/>');
    ctx = await surveyApp({ imgDir: dir });
    expect(headerOf((await ctx.app.inject('/s/pongal-2027')).body)).toContain('src="/public/img/logo.svg"');
  });

  it('Logo is light', () => {
    const served = findLogo('src/public/img');
    expect(served).toBe('/public/img/logo.svg');
    for (const file of ['src/public/img/logo.svg', 'src/public/img/logo.png']) {
      expect(statSync(file).size, file).toBeLessThanOrEqual(50 * 1024);
    }
    expect(readFileSync('src/public/img/logo.png').readUInt32BE(20)).toBeLessThanOrEqual(168); // PNG IHDR height
    expect(readFileSync('src/public/img/logo.svg', 'utf8')).not.toMatch(/<script|<image|\son\w+=/i);
  });
});

describe('Pongal banner', () => {
  it('Pongal 2027 hero', async () => {
    ctx = await surveyApp();
    const { body } = await ctx.app.inject('/s/pongal-2027');
    expect(body).toContain('<body class="theme-pongal">');
    expect(body).toContain('<img class="festive-hero__image" src="/public/img/pongal-hero.webp"');
    expect(body).toContain('alt="Pongal celebration with a decorated Pongal pot, sugarcane, flowers, kolam and decorated bulls"');
    expect(body).toContain(`<p class="festive-banner__greeting" lang="ta">${GREETING}</p>`);
    expect(body).toContain('<p class="festive-banner__event">Pongal 2027</p>');
    expect(body).not.toContain('data-motif=');
  });

  it('Screen reader', async () => {
    ctx = await surveyApp();
    const { body } = await ctx.app.inject('/s/pongal-2027');
    expect(body).toContain('alt="Pongal celebration with a decorated Pongal pot, sugarcane, flowers, kolam and decorated bulls"');
    expect(body).toContain(`<p class="festive-banner__greeting" lang="ta">${GREETING}</p>`);
  });

  it('Page weight', () => {
    expect(statSync(HERO).size).toBeLessThanOrEqual(250 * 1024);
    expect(readFileSync('src/modules/survey/views/themes/pongal/banner.eta', 'utf8')).not.toMatch(/https?:/);
  });

  it('Event without a theme', async () => {
    ctx = await surveyApp();
    const source = readFileSync('config/events/pongal-2027.yaml', 'utf8').replace('slug: pongal-2027', 'slug: plain-event').replace('theme: pongal\n', '');
    await seedEvents(ctx.db, [parseEventConfig(source, 'plain.yaml')], silentLogger);
    const { body } = await ctx.app.inject('/s/plain-event');
    expect(body).toContain('Eastcoast Tamil Community');
    expect(body).not.toContain('festive-banner');
    expect(body).toContain('<body>');
  });
});

describe('sections and themed pages', () => {
  it('Section headings', async () => {
    ctx = await surveyApp();
    const { body } = await ctx.app.inject('/s/pongal-2027');
    const headings = [...body.matchAll(/<h2 class="card__title" id="([^"]+)"><span lang="ta">([^<]+)<\/span>.*?<span>([^<]+)<\/span><\/h2>/g)].map((x) => [x[1], x[2], x[3]]);
    expect(headings).toEqual([
      ['section-about', 'உங்களைப் பற்றி', 'About you'],
      ['section-attending', 'வருகை', 'Attending'],
      ['section-food', 'உணவும் உதவியும்', 'Food &#38; helping'],
      ['section-finish', 'நிறைவு', 'Finish'],
    ]);
    const sectionOf = (field) => {
      const at = body.indexOf(field);
      return ['section-about', 'section-attending', 'section-food', 'section-finish'].filter((id) => body.indexOf(`id="${id}"`) < at).pop();
    };
    expect(['name="name"', 'name="email"', 'name="mobile"'].map(sectionOf)).toEqual(Array(3).fill('section-about'));
    expect(['name="days"', 'name="likelihood_2027-01-16"', 'name="headcount_kids_under_5"'].map(sectionOf)).toEqual(Array(3).fill('section-attending'));
    expect(['name="food"', 'name="roles"', 'name="cultural"', 'name="contribution"'].map(sectionOf)).toEqual(Array(4).fill('section-food'));
    expect(['name="comments"', 'name="consent"', 'type="submit"'].map(sectionOf)).toEqual(Array(3).fill('section-finish'));
  });

  it('Confirmation page themed', async () => {
    ctx = await surveyApp();
    const res = await ctx.submit();
    const page = await ctx.app.inject(res.headers.location);
    expect(page.body).toContain(GREETING);
    expect(page.body.indexOf('festive-banner')).toBeLessThan(page.body.indexOf('Thank you, Priya!'));
    expect(res.headers.location).toMatch(TOKEN_PATH);
  });

  it('Closed page themed', async () => {
    ctx = await surveyApp();
    ctx.clock.now = NOV_25;
    const { body } = await ctx.app.inject('/s/pongal-2027');
    expect(body).toContain(GREETING);
    expect(body).toContain('interest survey is now closed');
  });

  it('404 page still works without the theme', async () => {
    ctx = await surveyApp();
    const res = await ctx.app.inject('/s/diwali-1999');
    expect(res.statusCode).toBe(404);
    expect(res.body).toContain('Sorry, we couldn&#39;t find that page.');
    expect(res.body).not.toContain('festive-banner');
  });
});
