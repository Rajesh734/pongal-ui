// Survey validation shared by the server and the browser (loaded as /shared/survey-schema.js).
// The browser resolves 'zod' to /vendor/zod.mjs through an import map, so use only the public Zod API.
import { z } from 'zod';
import { messages as defaultMessages } from './survey-messages.js';

// No eval-based fast path: the site's CSP forbids 'unsafe-eval' in the browser.
z.config({ jitless: true });

export const LIKELIHOODS = ['definitely', 'likely', 'maybe'];
const NAME_RE = /^[\p{L}\p{M} '.-]+$/u;
const MOBILE_RE = /^[2-9]\d{2}[2-9]\d{6}$/;

const first = (v) => (Array.isArray(v) ? v[0] : v);
const text = (v) => (first(v) == null ? '' : String(first(v)));
const list = (v) => (v == null || v === '' ? [] : (Array.isArray(v) ? v : [v]).map(String));
const codesOf = (options) => options.map((o) => o.code);

export const likelihoodKey = (date) => `likelihood_${date}`;
export const headcountKey = (code) => `headcount_${code}`;

function mobileDigits(value) {
  let digits = value.replace(/[\s.\-()]/g, '');
  if (digits.startsWith('+1')) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  return digits;
}

/**
 * Builds the survey schema for one event. Input is the raw form object (strings, or arrays for repeated
 * fields); output is normalised answers. Each issue path is the form field name it belongs to.
 */
export function buildSurveySchema(survey, days, m = defaultMessages) {
  const choice = (options, message) => z.string().refine((v) => codesOf(options).includes(v), message);
  const fields = {
    name: z.string().trim().min(2, m.nameRequired).max(80, m.nameTooLong).regex(NAME_RE, m.nameChars),
    email: z.string().trim().toLowerCase().min(1, m.emailRequired).max(254, m.emailInvalid).regex(z.regexes.email, m.emailInvalid),
    mobile: z
      .string()
      .trim()
      .refine((v) => v === '' || MOBILE_RE.test(mobileDigits(v)), m.mobileInvalid)
      .transform((v) => (v === '' ? null : `+1${mobileDigits(v)}`)),
    days: z
      .array(z.string())
      .min(1, m.daysRequired)
      .refine((values) => values.every((d) => days.some((day) => day.date === d)), m.daysRequired),
    food: choice(survey.food_options, m.foodRequired),
    roles: z.array(z.string()).refine((values) => values.every((r) => codesOf(survey.volunteer_roles).includes(r)), m.rolesInvalid),
    cultural: choice(survey.cultural_options, m.culturalRequired),
    contribution: choice(survey.contribution_options, m.contributionRequired),
    comments: z
      .string()
      .trim()
      .superRefine((v, ctx) => {
        if (v.length > survey.comments_max) ctx.addIssue({ code: 'custom', message: m.commentsTooLong(survey.comments_max, v.length) });
      })
      .transform((v) => (v === '' ? null : v)),
    consent: z.literal(true, { error: m.consentRequired }),
  };
  const likelihood = (label) => z.string().refine((v) => LIKELIHOODS.includes(v), m.likelihoodRequired(label));
  const headcount = (band) =>
    z
      .string()
      .trim()
      .transform((v) => (v === '' ? '0' : v))
      .refine((v) => /^\d+$/.test(v), m.headcountWhole)
      .transform(Number)
      .refine((n) => n >= band.min && n <= band.max, m.headcountRange(band));

  return z.unknown().transform((raw, ctx) => {
    const input = raw && typeof raw === 'object' ? raw : {};
    let failed = false;
    const run = (key, schema, value) => {
      const result = schema.safeParse(value);
      if (result.success) return result.data;
      failed = true;
      ctx.addIssue({ code: 'custom', path: [key], message: result.error.issues[0].message });
      return undefined;
    };

    const name = run('name', fields.name, text(input.name));
    const email = run('email', fields.email, text(input.email));
    const mobileE164 = run('mobile', fields.mobile, text(input.mobile));
    const selected = run('days', fields.days, list(input.days)) ?? [];
    // Likelihood is asked only for ticked days; values left over for other days are ignored.
    const dayAnswers = days
      .filter((day) => selected.includes(day.date))
      .map((day) => ({ date: day.date, likelihood: run(likelihoodKey(day.date), likelihood(day.label), text(input[likelihoodKey(day.date)])) }));
    const headcounts = survey.headcount_bands.map((band) => ({
      code: band.code,
      count: run(headcountKey(band.code), headcount(band), text(input[headcountKey(band.code)])),
    }));
    if (headcounts.every((h) => h.count !== undefined)) {
      const total = headcounts.reduce((sum, h) => sum + h.count, 0);
      if (total > survey.max_total_people) {
        failed = true;
        ctx.addIssue({ code: 'custom', path: ['headcount'], message: m.groupTooLarge(survey.max_total_people) });
      }
    }
    const foodCode = run('food', fields.food, text(input.food));
    const volunteerRoles = run('roles', fields.roles, list(input.roles));
    const culturalCode = run('cultural', fields.cultural, text(input.cultural));
    const contributionCode = run('contribution', fields.contribution, text(input.contribution));
    const comments = run('comments', fields.comments, text(input.comments));
    const consentValue = first(input.consent);
    run('consent', fields.consent, consentValue === true || consentValue === 'yes');

    if (failed) return z.NEVER;
    return { name, email, mobileE164, days: dayAnswers, headcounts, foodCode, volunteerRoles, culturalCode, contributionCode, comments, consent: true };
  });
}

/** Returns { ok: true, data } or { ok: false, errors: { fieldName: message } } (first message per field). */
export function validateSurvey(schema, raw) {
  const result = schema.safeParse(raw);
  if (result.success) return { ok: true, data: result.data };
  const errors = {};
  for (const issue of result.error.issues) {
    const key = String(issue.path[0]);
    if (!(key in errors)) errors[key] = issue.message;
  }
  return { ok: false, errors };
}
