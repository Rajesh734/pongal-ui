import nodemailer from 'nodemailer';
import { createMessages } from '../../shared/survey-messages.js';
import { format } from '../../shared/i18n/translate.js';

const SEND_TIMEOUT_MS = 10_000;
const LIMIT_PER_HOUR = 3;
const HOUR_MS = 60 * 60 * 1000;

export function smtpConfigured(config) {
  return Boolean(config.SMTP_HOST && config.SMTP_USER && config.SMTP_PASS && config.SMTP_FROM);
}

function createTransport(config) {
  const port = config.SMTP_PORT ?? 587;
  return nodemailer.createTransport({
    host: config.SMTP_HOST,
    port,
    secure: port === 465,
    requireTLS: port !== 465,
    auth: { user: config.SMTP_USER, pass: config.SMTP_PASS },
    connectionTimeout: SEND_TIMEOUT_MS,
    greetingTimeout: SEND_TIMEOUT_MS,
    socketTimeout: SEND_TIMEOUT_MS,
  });
}

const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function editLinkEmail({ eventName, link, closesText, t = format }) {
  const m = createMessages(t);
  const intro = t('Here is your private link to change your {event} survey answers:', { event: eventName });
  const works = (until) => t('It works until {closes}.', { closes: until });
  const lines = [
    intro,
    link,
    works(closesText),
    m.emailNotYou,
  ];
  const html = [
    `<p>${escapeHtml(t('Here is your private link to change your {event} survey answers:', { event: eventName }))}</p>`,
    `<p><a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p>`,
    `<p>${escapeHtml(works(closesText))}</p>`,
    `<p>${escapeHtml(m.emailNotYou)}</p>`,
  ];
  return { subject: m.emailSubject(eventName), text: lines.join('\n\n'), html: html.join('\n') };
}

export function verificationEmail({ link, t = format }) {
  const intro = t('Use this one-time link to verify your household account:');
  const expiry = t('This link expires in 24 hours. If you did not request this, ignore this email.');
  const text = [intro, link, expiry];
  const html = [
    `<p>${escapeHtml(intro)}</p>`,
    `<p><a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p>`,
    `<p>${escapeHtml(expiry)}</p>`,
  ];
  return { subject: t('Verify your Pongal family account'), text: text.join('\n\n'), html: html.join('\n') };
}

export function registrationAccessEmail({ eventName, link, t = format }) {
  const intro = t('Your family registration for {event} is saved. Use this private link to review its status and payment instructions:', { event: eventName });
  const keep = t('Keep this link private. If you did not submit this registration, contact the organizers.');
  const text = [intro, link, keep];
  const html = [
    `<p>${escapeHtml(intro)}</p>`,
    `<p><a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p>`,
    `<p>${escapeHtml(keep)}</p>`,
  ];
  return { subject: t('{event} registration access', { event: eventName }), text: text.join('\n\n'), html: html.join('\n') };
}

/**
 * Returns null when SMTP is not fully configured. Send methods resolve true when sent, false when skipped
 * (per-recipient limit) or failed. Failures are logged without the address.
 */
export function createMailer(config, { transport, now = () => Date.now(), logger }) {
  if (!smtpConfigured(config)) return null;
  const smtp = transport ?? createTransport(config);
  const sent = new Map();

  async function send(to, message, label) {
      const at = now();
      const recent = (sent.get(to) ?? []).filter((t) => at - t < HOUR_MS);
      if (recent.length >= LIMIT_PER_HOUR) {
        logger.info(`${label} email skipped: recipient limit reached`);
        return false;
      }
      let timer;
      try {
        await Promise.race([
          smtp.sendMail({ from: config.SMTP_FROM, to, ...message }),
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })), SEND_TIMEOUT_MS);
          }),
        ]);
      } catch (err) {
        // SMTP error texts often quote the recipient, so log only the codes.
        logger.warn({ code: err.code ?? null, responseCode: err.responseCode ?? null }, `${label} email failed`);
        return false;
      } finally {
        clearTimeout(timer);
      }
      sent.set(to, [...recent, at]);
      return true;
  }

  return {
    sendEditLink: ({ to, eventName, link, closesText, t }) => send(to, editLinkEmail({ eventName, link, closesText, t }), 'Edit-link'),
    sendVerificationEmail: ({ to, link, t }) => send(to, verificationEmail({ link, t }), 'Verification'),
    sendRegistrationAccessEmail: ({ to, eventName, link, t }) => send(to, registrationAccessEmail({ eventName, link, t }), 'Registration-access'),
  };
}
