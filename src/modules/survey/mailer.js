import { fileURLToPath } from 'node:url';
import nodemailer from 'nodemailer';
import QRCode from 'qrcode';
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

export function registrationAccessEmail({ eventName, name, link, t = format }) {
  const message = brandedEmail({
    t,
    greeting: t('Welcome, {name}!', { name }),
    paragraphs: [
      t('Thank you for registering your family for {event}. We are delighted to welcome you and look forward to celebrating with you!', { event: eventName }),
      t('Your registration is saved. Use your private link below to review its status and payment instructions.'),
    ],
    highlight: t('After successful payment and organizer confirmation, you will receive the QR code for your entry.'),
    link,
    linkText: t('View my registration and payment instructions'),
    note: t('Keep this link private. If you did not submit this registration, contact the organizers.'),
  });
  return { subject: t('{event} registration access', { event: eventName }), ...message };
}

export function registrationConfirmedEmail({ eventName, name, link, qrPng, t = format }) {
  const message = brandedEmail({
    t,
    greeting: t('Welcome, {name}!', { name }),
    paragraphs: [
      t('Wonderful news! Your payment is confirmed and your family is officially part of {event}.', { event: eventName }),
      t('You are an important part of our Eastcoast Tamil family, and the celebration would not be the same without you. Get ready for tradition, music, delicious food and a joyful day with friends and neighbors!'),
    ],
    highlight: t('Your entry QR code is ready and shown below. Show it at the entrance; you can also find it anytime in your household account.'),
    qrPng,
    link,
    linkText: t('View my entry QR code'),
    note: t('We cannot wait to celebrate with you!'),
  });
  return { subject: t('{event}: you are confirmed!', { event: eventName }), ...message };
}

const SIGNATURE = 'Eastcoast Tamil Community, Dover, NH';
const LOGO_CID = 'community-logo';
const QR_CID = 'entry-qr-code';
const LOGO_PATH = fileURLToPath(new URL('../../public/img/logo-email.png', import.meta.url));

function brandedEmail({ t, greeting, paragraphs, highlight, qrPng, link, linkText, note }) {
  const closing = t('With warm regards,');
  const text = [greeting, ...paragraphs, highlight, `${linkText}: ${link}`, note, `${closing}\n${SIGNATURE}`].join('\n\n');
  const p = (s) => `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#3b2a1a">${escapeHtml(s)}</p>`;
  const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#fdf3e1;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fdf3e1;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:8px;overflow:hidden">
<tr><td style="background:#6d1b1b;height:8px;font-size:0;line-height:0">&nbsp;</td></tr>
<tr><td style="padding:28px 32px 8px">
<h1 style="margin:0 0 16px;font-size:24px;color:#6d1b1b">${escapeHtml(greeting)}</h1>
${paragraphs.map(p).join('\n')}
<div style="margin:0 0 20px;padding:14px 16px;background:#fff3b0;border-left:5px solid #e0a100;font-size:16px;line-height:1.5;color:#3b2a1a"><strong>${escapeHtml(highlight)}</strong></div>
${qrPng ? `<p style="margin:0 0 20px;text-align:center"><img src="cid:${QR_CID}" alt="Entry QR code" width="220" height="220" style="width:220px;height:220px;border:1px solid #e5d5b8;border-radius:6px"></p>` : ''}
<p style="margin:0 0 20px"><a href="${escapeHtml(link)}" style="display:inline-block;padding:12px 24px;background:#6d1b1b;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:bold;font-size:16px">${escapeHtml(linkText)}</a></p>
<p style="margin:0 0 24px;font-size:13px;line-height:1.5;color:#6b5a48">${escapeHtml(note)}</p>
<p style="margin:0 0 8px;font-size:16px;color:#3b2a1a">${escapeHtml(closing)}</p>
</td></tr>
<tr><td style="padding:0 32px 28px"><table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="padding-right:14px"><img src="cid:${LOGO_CID}" alt="Eastcoast Tamil Community" width="26" height="56" style="display:block;width:26px;height:56px"></td>
<td style="font-size:18px;font-weight:bold;color:#6d1b1b">${escapeHtml(SIGNATURE)}</td>
</tr></table></td></tr>
</table></td></tr></table></body></html>`;
  const attachments = [{ filename: 'logo.png', path: LOGO_PATH, cid: LOGO_CID }];
  if (qrPng) attachments.push({ filename: 'entry-qr-code.png', content: qrPng, contentType: 'image/png', cid: QR_CID });
  return { text, html, attachments };
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
    sendRegistrationAccessEmail: ({ to, eventName, name, link, t }) => send(to, registrationAccessEmail({ eventName, name, link, t }), 'Registration-access'),
    sendRegistrationConfirmedEmail: async ({ to, eventName, name, link, passToken, t }) => {
      const qrPng = passToken ? await QRCode.toBuffer(passToken, { errorCorrectionLevel: 'M', margin: 2, scale: 8 }) : undefined;
      return send(to, registrationConfirmedEmail({ eventName, name, link, qrPng, t }), 'Registration-confirmed');
    },
  };
}
