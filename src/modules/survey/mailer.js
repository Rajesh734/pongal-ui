import nodemailer from 'nodemailer';
import { messages as m } from '../../shared/survey-messages.js';

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

export function editLinkEmail({ eventName, link, closesText }) {
  const lines = [
    `Here is your private link to change your ${eventName} survey answers:`,
    link,
    `It works until ${closesText}.`,
    m.emailNotYou,
  ];
  const html = [
    `<p>Here is your private link to change your ${escapeHtml(eventName)} survey answers:</p>`,
    `<p><a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p>`,
    `<p>It works until ${escapeHtml(closesText)}.</p>`,
    `<p>${escapeHtml(m.emailNotYou)}</p>`,
  ];
  return { subject: m.emailSubject(eventName), text: lines.join('\n\n'), html: html.join('\n') };
}

/**
 * Returns null when SMTP is not fully configured. Otherwise { sendEditLink } which resolves true when the email
 * was sent, false when skipped (per-recipient limit) or failed. Failures are logged without the address.
 */
export function createMailer(config, { transport, now = () => Date.now(), logger }) {
  if (!smtpConfigured(config)) return null;
  const smtp = transport ?? createTransport(config);
  const sent = new Map();

  return {
    async sendEditLink({ to, eventName, link, closesText }) {
      const at = now();
      const recent = (sent.get(to) ?? []).filter((t) => at - t < HOUR_MS);
      if (recent.length >= LIMIT_PER_HOUR) {
        logger.info('Edit-link email skipped: recipient limit reached');
        return false;
      }
      let timer;
      try {
        await Promise.race([
          smtp.sendMail({ from: config.SMTP_FROM, to, ...editLinkEmail({ eventName, link, closesText }) }),
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })), SEND_TIMEOUT_MS);
          }),
        ]);
      } catch (err) {
        // SMTP error texts often quote the recipient, so log only the codes.
        logger.warn({ code: err.code ?? null, responseCode: err.responseCode ?? null }, 'Edit-link email failed');
        return false;
      } finally {
        clearTimeout(timer);
      }
      sent.set(to, [...recent, at]);
      return true;
    },
  };
}
