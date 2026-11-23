import { z } from 'zod';
import { PHONE_COUNTRIES } from './phone-countries.js';
import { calculateFamilyTotal, feeForAgeBand } from './registration-pricing.js';

const AGE_BANDS = ['11_plus', '5_to_10', 'under_5'];
const E164 = /^\+[1-9][0-9]{10,12}$/;
const PHONE_COUNTRY_CODES = new Set(PHONE_COUNTRIES.map((country) => country.code));
const OTHER_CALLING_CODE = /^\+[1-9][0-9]{0,2}$/;

function values(value) {
  if (value == null || value === '') return [];
  return Array.isArray(value) ? value : [value];
}

function checked(value) {
  return value === true || value === 'yes' || value === 'on';
}

function normalizedPhone(direct, countryCode, nationalNumber, otherCountryCode) {
  const raw = String(direct ?? '').trim();
  if (raw) return raw.replace(/[\s().-]/g, '');
  const digits = String(nationalNumber ?? '').replace(/\D/g, '');
  if (!digits) return '';
  const code = String(countryCode === 'other' ? otherCountryCode ?? '' : countryCode ?? '+1').trim();
  return `${code.startsWith('+') ? code : `+${code}`}${digits}`;
}

export function normalizeRegistrationInput(raw = {}) {
  const attendeeNames = values(raw.attendeeName);
  const attendeeAges = values(raw.attendeeAgeBand);
  const attendees = Array.isArray(raw.attendees)
    ? raw.attendees
    : attendeeNames.map((name, index) => ({
        name,
        ageBand: attendeeAges[index],
        willingToVolunteer: checked(raw[`attendeeWilling_${index}`]),
        volunteerRoles: values(raw[`attendeeRoles_${index}`]),
      }));

  const performanceTitles = values(raw.performanceTitle);
  const performances = Array.isArray(raw.performances)
    ? raw.performances
    : performanceTitles.map((title, index) => ({
        title,
        participantNames: values(raw.performanceParticipants)[index],
        participantCount: values(raw.performanceParticipantCount)[index],
        durationMinutes: values(raw.performanceDuration)[index],
        compereIntroduction: values(raw.performanceIntroduction)[index],
      })).filter((performance) => Object.values(performance).some((value) => value != null && String(value).trim() !== ''));

  const mobileCountryCode = raw.mobileCountryCode ?? '+1';
  const whatsappCountryCode = raw.whatsappCountryCode ?? '+1';
  return {
    contactName: raw.contactName ?? raw.name ?? attendees[0]?.name,
    contactEmail: raw.contactEmail ?? raw.email,
    mobileCountryCode,
    mobileNumber: raw.mobileNumber ?? '',
    mobileOtherCountryCode: raw.mobileOtherCountryCode ?? '',
    whatsappCountryCode,
    whatsappNumber: raw.whatsappNumber ?? '',
    whatsappOtherCountryCode: raw.whatsappOtherCountryCode ?? '',
    mobileE164: normalizedPhone(raw.mobileE164, mobileCountryCode, raw.mobileNumber, raw.mobileOtherCountryCode),
    whatsappE164: normalizedPhone(raw.whatsappE164, whatsappCountryCode, raw.whatsappNumber, raw.whatsappOtherCountryCode),
    whatsappConsent: checked(raw.whatsappConsent),
    attendees,
    performances,
  };
}

export function buildRegistrationSchema(registrationConfig) {
  const roleCodes = registrationConfig.volunteer_roles.map((role) => role.code);
  const attendeeSchema = z.object({
    name: z.string().trim().min(1, 'Enter a name for each attendee.').max(150, 'Attendee names can be up to 150 characters.'),
    ageBand: z.enum(AGE_BANDS, { error: 'Choose an age group for each attendee.' }),
    willingToVolunteer: z.boolean().default(false),
    volunteerRoles: z.array(z.string()).default([]),
  });
  const performanceSchema = z.object({
    title: z.string().trim().min(1, 'Enter a performance name or type.').max(150, 'Performance names can be up to 150 characters.'),
    participantNames: z.string().trim().min(1, 'Enter the performer or group name.').max(150, 'Performer or group names can be up to 150 characters.'),
    participantCount: z.coerce.number().int().min(1, 'Enter the number of performers.').max(100, 'A performance can include up to 100 performers.'),
    durationMinutes: z.coerce.number().int().min(1, 'Enter the performance duration in minutes.')
      .max(registrationConfig.performance_duration_minutes.group_5_plus, 'The performance duration exceeds the event maximum.'),
    compereIntroduction: z.string().trim().min(1, 'Enter a short introduction for the compere.').max(500, 'The compere introduction can be up to 500 characters.'),
  });

  return z
    .object({
      contactName: z.string().trim().min(2, 'Enter the primary contact name.').max(150, 'The contact name can be up to 150 characters.'),
      contactEmail: z.string().trim().toLowerCase().max(254).regex(z.regexes.email, 'Enter a valid email address.'),
      mobileCountryCode: z.string().refine((value) => PHONE_COUNTRY_CODES.has(value), 'Choose a country code for the mobile number.'),
      mobileOtherCountryCode: z.string(),
      mobileNumber: z.string(),
      mobileE164: z.string().regex(E164, 'Enter a valid mobile number for the selected country.'),
      whatsappCountryCode: z.string().refine((value) => PHONE_COUNTRY_CODES.has(value), 'Choose a country code for the WhatsApp number.'),
      whatsappOtherCountryCode: z.string(),
      whatsappNumber: z.string(),
      whatsappE164: z.union([z.literal(''), z.string().regex(E164, 'Enter a valid WhatsApp number for the selected country.')]).transform((value) => value || null),
      whatsappConsent: z.boolean(),
      attendees: z.array(attendeeSchema).min(1, 'Add at least one attendee to continue.').max(100, 'A registration can include up to 100 attendees.'),
      performances: z.array(performanceSchema).max(registrationConfig.max_performances, 'A family may register up to two performances. Contact the organizers for more.'),
    })
    .superRefine((data, ctx) => {
      if (data.mobileCountryCode === 'other' && !OTHER_CALLING_CODE.test(data.mobileOtherCountryCode)) {
        ctx.addIssue({ code: 'custom', path: ['mobileE164'], message: 'Enter a valid calling code for the mobile number.' });
      }
      if (data.whatsappE164 && data.whatsappCountryCode === 'other' && !OTHER_CALLING_CODE.test(data.whatsappOtherCountryCode)) {
        ctx.addIssue({ code: 'custom', path: ['whatsappE164'], message: 'Enter a valid calling code for the WhatsApp number.' });
      }
      if (data.whatsappE164 && !data.whatsappConsent) {
        ctx.addIssue({ code: 'custom', path: ['whatsappConsent'], message: 'Please agree before we contact you on WhatsApp.' });
      }
      if (data.mobileNumber.replace(/\D/g, '').length !== 10) {
        ctx.addIssue({ code: 'custom', path: ['mobileE164'], message: 'Enter a 10-digit mobile number.' });
      }
      if (data.whatsappNumber && data.whatsappNumber.replace(/\D/g, '').length !== 10) {
        ctx.addIssue({ code: 'custom', path: ['whatsappE164'], message: 'Enter a 10-digit WhatsApp number.' });
      }
      if (data.attendees[0]?.ageBand !== '11_plus') {
        ctx.addIssue({ code: 'custom', path: ['attendees', 0, 'ageBand'], message: 'The primary contact must be age 11 or older.' });
      }
      for (const [index, attendee] of data.attendees.entries()) {
        if (attendee.ageBand !== '11_plus' && (attendee.willingToVolunteer || attendee.volunteerRoles.length > 0)) {
          ctx.addIssue({
            code: 'custom',
            path: ['attendees', index, 'willingToVolunteer'],
            message: 'Attendees under age 11 cannot volunteer.',
          });
        }
        const invalidRole = attendee.volunteerRoles.some((role) => !roleCodes.includes(role));
        if (invalidRole) {
          ctx.addIssue({ code: 'custom', path: ['attendees', index, 'volunteerRoles'], message: 'Choose volunteer roles from the listed options.' });
        }
        if (attendee.willingToVolunteer && attendee.volunteerRoles.length === 0) {
          ctx.addIssue({ code: 'custom', path: ['attendees', index, 'volunteerRoles'], message: 'Choose at least one volunteer role or clear willing to volunteer.' });
        }
        if (!attendee.willingToVolunteer && attendee.volunteerRoles.length > 0) {
          ctx.addIssue({ code: 'custom', path: ['attendees', index, 'willingToVolunteer'], message: 'Select willing to volunteer before choosing roles.' });
        }
      }
      for (const [index, performance] of data.performances.entries()) {
        const maxDuration = performance.participantCount === 1
          ? registrationConfig.performance_duration_minutes.solo
          : performance.participantCount <= 4
            ? registrationConfig.performance_duration_minutes.group_2_to_4
            : registrationConfig.performance_duration_minutes.group_5_plus;
        if (performance.durationMinutes > maxDuration) {
          ctx.addIssue({
            code: 'custom',
            path: ['performances', index, 'durationMinutes'],
            message: `The maximum performance time is ${registrationConfig.performance_duration_minutes.solo} minutes for a solo, ${registrationConfig.performance_duration_minutes.group_2_to_4} minutes for 2-4 performers, or ${registrationConfig.performance_duration_minutes.group_5_plus} minutes for 5 or more performers.`,
          });
        }
      }
    })
    .transform((data) => {
      const attendees = data.attendees.map((attendee) => ({
        ...attendee,
        feeCents: feeForAgeBand(attendee.ageBand, registrationConfig.prices_cents),
      }));
      return {
        ...data,
        attendees,
        totalCents: calculateFamilyTotal(attendees, registrationConfig.prices_cents),
      };
    });
}

export function validateRegistration(schema, raw) {
  const result = schema.safeParse(normalizeRegistrationInput(raw));
  if (result.success) return { ok: true, data: result.data };
  const errors = {};
  for (const issue of result.error.issues) {
    const key = String(issue.path[0] ?? 'form');
    if (!(key in errors)) errors[key] = issue.message;
  }
  const normalized = normalizeRegistrationInput(raw);
  if (normalized.mobileNumber.replace(/\D/g, '').length !== 10) errors.mobileE164 = 'Enter a 10-digit mobile number.';
  if (normalized.whatsappNumber && normalized.whatsappNumber.replace(/\D/g, '').length !== 10) {
    errors.whatsappE164 = 'Enter a 10-digit WhatsApp number.';
  }
  if (normalized.mobileCountryCode === 'other' && !OTHER_CALLING_CODE.test(normalized.mobileOtherCountryCode)) {
    errors.mobileE164 = 'Enter a valid calling code for the mobile number.';
  }
  if (normalized.whatsappE164 && normalized.whatsappCountryCode === 'other' && !OTHER_CALLING_CODE.test(normalized.whatsappOtherCountryCode)) {
    errors.whatsappE164 = 'Enter a valid calling code for the WhatsApp number.';
  }
  return { ok: false, errors };
}