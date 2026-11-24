import { createHash } from 'node:crypto';
import { clientIp, turnstileEnabled, verifyTurnstile } from '../../core/abuse.js';
import { surveyState } from '../../core/survey-state.js';
import { formatLongInZone } from '../../core/time.js';
import { createMessages, messages } from '../../shared/survey-messages.js';
import { buildSurveySchema, headcountKey, likelihoodKey, validateSurvey } from '../../shared/survey-schema.js';
import { findActiveByTokenHash, findEventBySlug, listEvents, loadAnswers } from './repo.js';
import { saveFromEditLink, saveFromPublicForm } from './service.js';
import { hashToken, isWellFormedToken } from './tokens.js';

const VIEWS = 'modules/survey/views';
const BODY_LIMIT = 16 * 1024;

// The browser resolves the shared schema's `import 'zod'` through this import map (design D2).
export const IMPORT_MAP = '{"imports":{"zod":"/vendor/zod.mjs"}}';
export const IMPORT_MAP_CSP_HASH = `'sha256-${createHash('sha256').update(IMPORT_MAP).digest('base64')}'`;

const isEmpty = (v) => v == null || v === '' || (Array.isArray(v) && v.every((x) => x === ''));

function surveyConfigJson(event, mode, email) {
  const { survey, days } = event.configSnapshot;
  // Only what the shared schema needs; internal settings (weights, price tiers) stay on the server.
  const browserSurvey = {
    headcount_bands: survey.headcount_bands.map(({ code, label, min, max }) => ({ code, label, min, max })),
    max_total_people: survey.max_total_people,
    food_options: survey.food_options,
    volunteer_roles: survey.volunteer_roles,
    cultural_options: survey.cultural_options,
    contribution_options: survey.contribution_options,
    comments_max: survey.comments_max,
  };
  // Escape "<" so the JSON can never close its <script> element.
  return JSON.stringify({ survey: browserSurvey, days, mode, email: email ?? null }).replace(/</g, '\\u003c');
}

function nationalMobile(e164) {
  if (!e164) return '';
  const d = e164.slice(2);
  return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
}

/** Saved answers in the same shape the form posts, for pre-filling the edit page. */
function formValues(household, response, answers) {
  const values = {
    name: household.name,
    email: household.email,
    mobile: nationalMobile(household.mobileE164),
    days: answers.days.map((d) => d.date),
    food: response.foodCode,
    roles: answers.roles,
    cultural: response.culturalCode,
    contribution: response.contributionCode,
    comments: response.comments ?? '',
    consent: 'yes',
  };
  for (const d of answers.days) values[likelihoodKey(d.date)] = d.likelihood;
  for (const h of answers.headcounts) values[headcountKey(h.code)] = String(h.count);
  return values;
}

/** Label-based summary rows of saved answers for the confirmation page. */
function summaryRows(event, household, response, answers, t) {
  const { survey, days } = event.configSnapshot;
  const label = (options, code) => t(options.find((o) => o.code === code)?.label ?? code);
  const likelihoodLabel = { definitely: t('Definitely'), likely: t('Likely'), maybe: t('Maybe') };
  return [
    [t('Name'), household.name],
    [t('Email'), household.email],
    [t('Mobile'), household.mobileE164 ? nationalMobile(household.mobileE164) : t('Not given')],
    ...answers.days.map((d) => [t(days.find((x) => x.date === d.date)?.label ?? d.date), likelihoodLabel[d.likelihood]]),
    ...survey.headcount_bands.map((b) => [t(b.label), String(answers.headcounts.find((h) => h.code === b.code)?.count ?? 0)]),
    [t('Food preference'), label(survey.food_options, response.foodCode)],
    [t('Volunteer roles'), answers.roles.length ? answers.roles.map((r) => label(survey.volunteer_roles, r)).join(', ') : t('None')],
    [t('Cultural performance'), label(survey.cultural_options, response.culturalCode)],
    [t('Contribution per adult'), label(survey.contribution_options, response.contributionCode)],
    [t('Comments'), response.comments ?? t('None')],
  ];
}

export async function surveyRoutes(app, { db, config, now = () => new Date(), fetchImpl = fetch, mailer = null }) {
  const turnstile = turnstileEnabled(config);
  const schemas = new Map();
  const mFor = (request) => createMessages((key, vars) => request.t(key, vars));
  const schemaFor = (event, request) => {
    const key = `${event.id}:${event.configHash}:${request.locale}`;
    if (!schemas.has(key)) {
      schemas.set(key, buildSurveySchema(event.configSnapshot.survey, event.configSnapshot.days, mFor(request)));
    }
    return schemas.get(key);
  };

  const submissionLimit = app.rateLimit({
    max: 10,
    timeWindow: 60 * 60 * 1000,
    keyGenerator: clientIp,
    errorResponseBuilder: () => ({ statusCode: 429, message: messages.tooManySubmissions }),
  });
  const postOptions = { bodyLimit: BODY_LIMIT, onRequest: submissionLimit };

  const themed = (event, m) => (event ? { theme: event.configSnapshot.theme ?? null, eventName: event.name, m } : { theme: null, m });

  const message = (reply, title, text, { status = 200, link, event } = {}) =>
    reply.code(status).view(`${VIEWS}/message.eta`, {
      title: reply.request.t(title),
      message: reply.request.t(text),
      link: link ? { ...link, text: reply.request.t(link.text) } : link,
      ...themed(event, mFor(reply.request)),
    });

  const windowPage = (reply, event, state) =>
    state === 'not_open'
      ? message(reply, event.name, mFor(reply.request).notOpen(event.name, formatLongInZone(event.surveyOpensAt, event.timezone)), { event })
      : message(reply, event.name, event.configSnapshot.survey.closed_message, { event });

  const invalidLink = (reply, event) =>
    message(reply, 'Link not valid', mFor(reply.request).invalidLink, { status: 404, link: { href: `/s/${event.slug}`, text: 'Fill in the survey' }, event });

  const renderForm = (reply, event, { mode, action, values = {}, errors = {}, summary = null, email = null, status = 200 }) => {
    const count = Object.keys(errors).length;
    const m = mFor(reply.request);
    return reply.code(status).view(`${VIEWS}/form.eta`, {
      title: event.name,
      event,
      survey: event.configSnapshot.survey,
      days: event.configSnapshot.days,
      mode,
      action,
      values,
      errors,
      email,
      summary: summary ?? (count ? m.errorSummary(count) : null),
      turnstileSiteKey: turnstile ? config.TURNSTILE_SITE_KEY : null,
      importMap: IMPORT_MAP,
      configJson: surveyConfigJson(event, mode, email),
      ...themed(event, m),
      likelihoodKey,
      headcountKey,
    });
  };

  async function loadEvent(request, reply) {
    const event = await findEventBySlug(db, request.params.event);
    if (!event) {
      reply.callNotFound();
      return null;
    }
    return event;
  }

  async function findByToken(event, token) {
    if (!isWellFormedToken(token)) return null;
    return findActiveByTokenHash(db, event.id, hashToken(config.EDIT_TOKEN_KEY, token));
  }

  /**
   * Honeypot and Turnstile checks shared by both POST routes. Returns true when a page was sent and the request
   * must stop. (It cannot return the reply itself: a Fastify reply is thenable, so `await` would unwrap it.)
   */
  async function screen(request, reply, event, form) {
    const m = mFor(request);
    if (!isEmpty(request.body?.website)) {
      request.log.info('honeypot triggered');
      message(reply, event.name, m.honeypotThanks, { event });
      return true;
    }
    if (!turnstile) return false;
    const result = await verifyTurnstile({
      secret: config.TURNSTILE_SECRET,
      token: request.body?.['cf-turnstile-response'],
      ip: clientIp(request),
      fetchImpl,
    });
    if (result.outcome === 'ok') return false;
    let summary = m.turnstileFailed;
    if (result.outcome === 'misconfigured') {
      const reason = result.codes.length ? result.codes.join(', ') : `HTTP ${result.status}`;
      request.log.error(`Turnstile rejected the secret key (${reason}) - check TURNSTILE_SECRET and TURNSTILE_SITE_KEY`);
      summary = m.turnstileMisconfigured;
    } else if (result.outcome === 'unreachable') {
      request.log.warn({ status: result.status ?? null, error: result.error ?? null }, 'Turnstile verification unreachable');
      summary = m.turnstileUnreachable;
    }
    renderForm(reply, event, { ...form, summary, status: 400 });
    return true;
  }

  const editUrl = (event, token) => `/s/${event.slug}/edit/${token}`;

  app.get('/', async (request, reply) => {
    const candidates = await listEvents(db);
    const event = candidates.find((candidate) => candidate.slug === 'pongal-2027' && candidate.configSnapshot?.registration);
    if (!event) return reply.callNotFound();
    return reply.view(`${VIEWS}/home.eta`, { title: request.t('Home'), event });
  });

  app.get('/about', async (request, reply) => reply.view(`${VIEWS}/about.eta`, { title: request.t('About') }));

  app.get('/s/:event', async (request, reply) => {
    const event = await loadEvent(request, reply);
    if (!event) return reply;
    const state = surveyState(event, now());
    if (state !== 'open') return windowPage(reply, event, state);
    return renderForm(reply, event, { mode: 'new', action: `/s/${event.slug}` });
  });

  app.post('/s/:event', postOptions, async (request, reply) => {
    const event = await loadEvent(request, reply);
    if (!event) return reply;
    const state = surveyState(event, now());
    if (state !== 'open') return windowPage(reply, event, state);

    const values = request.body ?? {};
    const form = { mode: 'new', action: `/s/${event.slug}`, values };
    if (await screen(request, reply, event, form)) return reply;

    const result = validateSurvey(schemaFor(event, request), values);
    if (!result.ok) return renderForm(reply, event, { ...form, errors: result.errors, status: 400 });

    const saved = await saveFromPublicForm(db, { event, data: result.data, tokenKey: config.EDIT_TOKEN_KEY, now: now() });
    let emailed = false;
    if (mailer) {
      emailed = await mailer.sendEditLink({
        to: saved.household.email,
        eventName: event.name,
        link: `${request.protocol}://${request.host}${editUrl(event, saved.token)}`,
        closesText: formatLongInZone(event.surveyClosesAt, event.timezone),
        t: (key, vars) => request.t(key, vars),
      });
    }
    const query = `?saved=${saved.created ? 'new' : 'updated'}${emailed ? '&emailed=1' : ''}`;
    return reply.redirect(`${editUrl(event, saved.token)}${query}`, 303);
  });

  app.get('/s/:event/edit/:token', async (request, reply) => {
    const event = await loadEvent(request, reply);
    if (!event) return reply;
    const state = surveyState(event, now());
    if (state !== 'open') return windowPage(reply, event, state);
    const found = await findByToken(event, request.params.token);
    if (!found) return invalidLink(reply, event);

    const { household, response } = found;
    const answers = await loadAnswers(db, response.id);
    const { saved, emailed } = request.query ?? {};
    if (saved === 'new' || saved === 'updated') {
      const m = mFor(request);
      return reply.view(`${VIEWS}/confirmation.eta`, {
        title: event.name,
        heading: saved === 'new' ? m.savedNew(household.name, event.name) : m.savedUpdated(household.name, event.name),
        rows: summaryRows(event, household, response, answers, (key, vars) => request.t(key, vars)),
        link: `${request.protocol}://${request.host}${editUrl(event, request.params.token)}`,
        editPath: editUrl(event, request.params.token),
        saveLink: m.saveLink(formatLongInZone(event.surveyClosesAt, event.timezone)),
        emailedNote: emailed === '1' ? m.emailed(household.email) : null,
        importMap: IMPORT_MAP,
        ...themed(event, m),
      });
    }
    return renderForm(reply, event, {
      mode: 'edit',
      action: editUrl(event, request.params.token),
      values: formValues(household, response, answers),
      email: household.email,
    });
  });

  app.post('/s/:event/edit/:token', postOptions, async (request, reply) => {
    const event = await loadEvent(request, reply);
    if (!event) return reply;
    const state = surveyState(event, now());
    if (state !== 'open') return windowPage(reply, event, state);
    const found = await findByToken(event, request.params.token);
    if (!found) return invalidLink(reply, event);

    // The email is fixed by the link; any submitted value is ignored.
    const values = { ...(request.body ?? {}), email: found.household.email };
    const form = { mode: 'edit', action: editUrl(event, request.params.token), values, email: found.household.email };
    if (await screen(request, reply, event, form)) return reply;

    const result = validateSurvey(schemaFor(event, request), values);
    if (!result.ok) return renderForm(reply, event, { ...form, errors: result.errors, status: 400 });

    await saveFromEditLink(db, { event, ...found, data: result.data, now: now() });
    return reply.redirect(`${editUrl(event, request.params.token)}?saved=updated`, 303);
  });
}
