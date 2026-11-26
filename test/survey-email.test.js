import { afterEach, describe, expect, it } from 'vitest';
import { createMailer, editLinkEmail, registrationAccessEmail, verificationEmail } from '../src/modules/survey/mailer.js';
import { validForm } from './helpers.js';
import { translatorFor } from '../src/shared/i18n/index.js';
import { surveyApp, TOKEN_PATH } from './survey-app.js';

const SMTP = { SMTP_HOST: 'smtp.gmail.com', SMTP_PORT: 587, SMTP_USER: 'site@example.org', SMTP_PASS: 'app-password', SMTP_FROM: 'Pongal <site@example.org>' };

let ctx;
afterEach(async () => {
  await ctx?.app.close();
  ctx = undefined;
});

function stubTransport({ fail } = {}) {
  const sent = [];
  return {
    sent,
    sendMail: async (msg) => {
      if (fail) throw Object.assign(new Error(`550 5.1.1 <${msg.to}>: Recipient address rejected`), { code: 'EENVELOPE', responseCode: 550 });
      sent.push(msg);
      return { messageId: 'x' };
    },
  };
}

function captureLogger() {
  const lines = [];
  const push = (...args) => lines.push(JSON.stringify(args));
  return { lines, info: push, warn: push, error: push };
}

async function appWithMailer({ transport, clock = { ms: Date.parse('2026-11-21T02:00:00Z') }, logger = captureLogger() } = {}) {
  const mailer = createMailer(SMTP, { transport, now: () => clock.ms, logger });
  ctx = await surveyApp({ mailer });
  return { clock, logger };
}

describe('edit-link email', () => {
  it('only creates a transport when every SMTP setting is present', () => {
    expect(createMailer({}, { logger: captureLogger() })).toBeNull();
    expect(createMailer({ ...SMTP, SMTP_PASS: undefined }, { logger: captureLogger() })).toBeNull();
    expect(createMailer(SMTP, { logger: captureLogger() })).not.toBeNull();
  });

  it('Email sent', async () => {
    const transport = stubTransport();
    await appWithMailer({ transport });
    const res = await ctx.submit({ comments: 'Private answer', food: 'non_veg' }, { host: 'survey.example.org', 'x-forwarded-proto': 'https' });
    expect(res.headers.location).toMatch(/\?saved=new&emailed=1$/);
    expect(transport.sent).toHaveLength(1);
    const [mail] = transport.sent;
    expect(mail.to).toBe('priya@example.com');
    expect(mail.subject).toBe('Your Pongal 2027 survey link');
    const token = res.headers.location.match(TOKEN_PATH)[1];
    for (const body of [mail.text, mail.html]) {
      expect(body).toContain(`https://survey.example.org/s/pongal-2027/edit/${token}`);
      expect(body).toContain('Tuesday, November 24 at 11:59 PM ET');
      expect(body).not.toContain('Private answer');
      expect(body).not.toContain('Non-veg');
    }
    expect(mail.text).toContain("If you didn't fill in this survey, please reply to this email.");
    const page = await ctx.app.inject(res.headers.location);
    expect(page.body).toContain('We&#39;ve also emailed this link to priya@example.com.');
  });

  it('SMTP not configured', async () => {
    ctx = await surveyApp();
    const res = await ctx.submit();
    expect(res.headers.location).toMatch(/\?saved=new$/);
    const page = await ctx.app.inject(res.headers.location);
    expect(page.body).not.toContain('emailed this link');
  });

  it('Sending fails', async () => {
    const { logger } = await appWithMailer({ transport: stubTransport({ fail: true }) });
    const res = await ctx.submit();
    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toMatch(/\?saved=new$/);
    expect(await ctx.count('survey_responses')).toBe(1);
    const page = await ctx.app.inject(res.headers.location);
    expect(page.body).not.toContain('emailed this link');
    expect(logger.lines.join('\n')).toContain('Edit-link email failed');
    expect(logger.lines.join('\n')).not.toContain('priya');
  });

  it('does not email on saves through the edit link', async () => {
    const transport = stubTransport();
    await appWithMailer({ transport });
    const res = await ctx.submit();
    const editUrl = res.headers.location.match(TOKEN_PATH)[0];
    const edit = await ctx.post(editUrl, validForm());
    expect(edit.headers.location).toMatch(/\?saved=updated$/);
    expect(transport.sent).toHaveLength(1);
  });

  it('Fourth save in an hour', async () => {
    const transport = stubTransport();
    const { clock } = await appWithMailer({ transport });
    for (let i = 0; i < 3; i += 1) {
      expect((await ctx.submit()).headers.location).toMatch(/&emailed=1$/);
      clock.ms += 5 * 60 * 1000;
    }
    const fourth = await ctx.submit({ email: 'Priya@Example.com' });
    expect(fourth.statusCode).toBe(303);
    expect(fourth.headers.location).toMatch(/\?saved=updated$/);
    expect(transport.sent).toHaveLength(3);
    expect((await ctx.app.inject(fourth.headers.location)).body).not.toContain('emailed this link');

    clock.ms += 60 * 60 * 1000;
    expect((await ctx.submit()).headers.location).toMatch(/&emailed=1$/);
  });

  it('escapes the link and event name in the HTML body', () => {
    const { html } = editLinkEmail({ eventName: 'A <b>', link: 'https://x/"y', closesText: 'soon' });
    expect(html).not.toContain('<b>');
    expect(html).not.toContain('"y');
  });
});

describe('household verification email', () => {
  it('sends an escaped single-use verification link', async () => {
    const transport = stubTransport();
    const mailer = createMailer(SMTP, { transport, logger: captureLogger() });
    const link = 'https://portal.example.org/auth/verify/token?x=<value>';

    await expect(mailer.sendVerificationEmail({ to: 'priya@example.com', link })).resolves.toBe(true);
    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0].subject).toBe('Verify your Pongal family account');
    expect(transport.sent[0].text).toContain(link);
    expect(transport.sent[0].html).toContain('&#60;value&#62;');
    expect(transport.sent[0].text).toContain('expires in 24 hours');
  });

  it('uses the same recipient limit for verification emails', async () => {
    const transport = stubTransport();
    const mailer = createMailer(SMTP, { transport, logger: captureLogger() });
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await mailer.sendVerificationEmail({ to: 'priya@example.com', link: 'https://portal.example.org/verify' });
    }
    expect(transport.sent).toHaveLength(3);
  });

  it('escapes verification links in the HTML body', () => {
    const { html } = verificationEmail({ link: 'https://portal.example.org/"quoted"' });
    expect(html).not.toContain('"quoted"');
  });
});

describe('registration access email', () => {
  it('sends a private guest link without registration details', async () => {
    const transport = stubTransport();
    const mailer = createMailer(SMTP, { transport, logger: captureLogger() });
    const link = 'https://portal.example.org/register/access/opaque-token';
    await expect(mailer.sendRegistrationAccessEmail({ to: 'priya@example.com', eventName: 'Pongal 2027', link })).resolves.toBe(true);
    expect(transport.sent[0].to).toBe('priya@example.com');
    expect(transport.sent[0].subject).toBe('Pongal 2027 registration access');
    expect(transport.sent[0].text).toContain(link);
    expect(transport.sent[0].text).toContain('Keep this link private.');
    expect(transport.sent[0].text).not.toContain('attendee');
  });

  it('sends a branded confirmation email with the QR note and logo', async () => {
    const transport = stubTransport();
    const mailer = createMailer(SMTP, { transport, logger: captureLogger() });
    const link = 'https://portal.example.org/account/registrations';
    await expect(mailer.sendRegistrationConfirmedEmail({ to: 'priya@example.com', eventName: 'Pongal 2027', name: 'Priya', link, passToken: 'opaque-pass-token' })).resolves.toBe(true);
    const [message] = transport.sent;
    expect(message.subject).toBe('Pongal 2027: you are confirmed!');
    expect(message.html).toContain(`href="${link}"`);
    expect(message.html).toContain('Eastcoast Tamil Community, Dover, NH');
    expect(message.attachments[0].cid).toBe('community-logo');
    expect(message.attachments[1]).toMatchObject({ cid: 'entry-qr-code', contentType: 'image/png' });
    expect(message.html).toContain('cid:entry-qr-code');
  });

  it('translates the registration email', () => {
    const t = translatorFor('ta');
    expect(registrationAccessEmail({ eventName: 'Pongal 2027', name: 'Priya', link: 'https://x.org/a', t }).text).toContain('வரவேற்கிறோம், Priya');
  });

  it('escapes event names in the HTML body', () => {
    const { html } = registrationAccessEmail({ eventName: 'Pongal <2027>', link: 'https://portal.example.org/access' });
    expect(html).toContain('Pongal &#60;2027&#62;');
    expect(html).not.toContain('<2027>');
  });
});
