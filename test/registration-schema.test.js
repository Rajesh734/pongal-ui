import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseEventConfig } from '../src/core/event-config.js';
import { buildRegistrationSchema, normalizeRegistrationInput, validateRegistration } from '../src/shared/registration-schema.js';
import { calculateFamilyTotal } from '../src/shared/registration-pricing.js';

const eventConfig = parseEventConfig(
  readFileSync('config/events/pongal-2027.yaml', 'utf8'),
  'config/events/pongal-2027.yaml',
);
const schema = buildRegistrationSchema(eventConfig.config.registration);

function validRegistration(overrides = {}) {
  return {
    contactName: 'Priya',
    contactEmail: 'Priya@Example.com',
    mobileCountryCode: '+1',
    mobileNumber: '6039700000',
    whatsappCountryCode: '+91',
    whatsappNumber: '9876543210',
    whatsappConsent: true,
    attendees: [
      { name: 'Priya', ageBand: '11_plus', willingToVolunteer: true, volunteerRoles: ['registration_desk'] },
      { name: 'Arun', ageBand: '5_to_10', willingToVolunteer: false, volunteerRoles: [] },
      { name: 'Nila', ageBand: 'under_5', willingToVolunteer: false, volunteerRoles: [] },
    ],
    performances: [],
    ...overrides,
  };
}

describe('registration schema', () => {
  it('calculates the family total from attendee age bands', () => {
    const result = validateRegistration(schema, validRegistration());
    expect(result.ok).toBe(true);
    expect(result.data.contactEmail).toBe('priya@example.com');
    expect(result.data.mobileE164).toBe('+16039700000');
    expect(result.data.whatsappE164).toBe('+919876543210');
    expect(result.data.attendees.map((attendee) => attendee.feeCents)).toEqual([3500, 2500, 0]);
    expect(result.data.totalCents).toBe(6000);
  });

  it('calculates the mixed-age $95 example and changes the total when an age band changes', () => {
    const attendees = [
      { ageBand: '11_plus' },
      { ageBand: '11_plus' },
      { ageBand: '5_to_10' },
      { ageBand: 'under_5' },
    ];
    const prices = eventConfig.config.registration.prices_cents;
    expect(calculateFamilyTotal(attendees, prices)).toBe(9500);
    attendees[3].ageBand = '5_to_10';
    expect(calculateFamilyTotal(attendees, prices)).toBe(12000);
  });

  it('accepts named volunteers without re-entering their names', () => {
    const result = validateRegistration(schema, validRegistration());
    expect(result.data.attendees[0]).toMatchObject({ name: 'Priya', willingToVolunteer: true, volunteerRoles: ['registration_desk'] });
  });

  it('uses the first attendee as the primary contact name', () => {
    const result = validateRegistration(schema, validRegistration({ contactName: undefined }));
    expect(result.ok).toBe(true);
    expect(result.data.contactName).toBe('Priya');
  });

  it('requires the first attendee and primary contact to be an adult', () => {
    const result = validateRegistration(schema, validRegistration({
      attendees: [{ name: 'Priya', ageBand: '5_to_10', willingToVolunteer: false, volunteerRoles: [] }],
    }));
    expect(result.ok).toBe(false);
    expect(result.errors.attendees).toBe('The primary contact must be age 11 or older.');
  });

  it('allows additional attendees in every age band while keeping the primary adult', () => {
    const result = validateRegistration(schema, validRegistration({
      attendees: [
        { name: 'Priya', ageBand: '11_plus', willingToVolunteer: false, volunteerRoles: [] },
        { name: 'Arun', ageBand: '11_plus', willingToVolunteer: false, volunteerRoles: [] },
      ],
    }));
    expect(result.ok).toBe(true);
    expect(result.data.attendees.map((attendee) => attendee.feeCents)).toEqual([3500, 3500]);
  });

  it('rejects volunteer selections for attendees under age 11', () => {
    const result = validateRegistration(schema, validRegistration({
      attendees: [
        { name: 'Priya', ageBand: '11_plus', willingToVolunteer: false, volunteerRoles: [] },
        { name: 'Arun', ageBand: '5_to_10', willingToVolunteer: true, volunteerRoles: ['registration_desk'] },
      ],
    }));
    expect(result.ok).toBe(false);
    expect(result.errors.attendees).toBe('Attendees under age 11 cannot volunteer.');
  });

  it('rejects volunteer roles without opt-in or without a selected role', () => {
    const roleWithoutOptIn = validateRegistration(schema, validRegistration({
      attendees: [{ name: 'Priya', ageBand: '11_plus', willingToVolunteer: false, volunteerRoles: ['registration_desk'] }],
    }));
    expect(roleWithoutOptIn.ok).toBe(false);
    expect(roleWithoutOptIn.errors.attendees).toBe('Select willing to volunteer before choosing roles.');

    const optInWithoutRole = validateRegistration(schema, validRegistration({
      attendees: [{ name: 'Priya', ageBand: '11_plus', willingToVolunteer: true, volunteerRoles: [] }],
    }));
    expect(optInWithoutRole.ok).toBe(false);
    expect(optInWithoutRole.errors.attendees).toBe('Choose at least one volunteer role or clear willing to volunteer.');
  });

  it('rejects volunteer roles not in the agreed list', () => {
    const result = validateRegistration(schema, validRegistration({
      attendees: [{ name: 'Priya', ageBand: '11_plus', willingToVolunteer: true, volunteerRoles: ['dj'] }],
    }));
    expect(result.ok).toBe(false);
    expect(result.errors.attendees).toBe('Choose volunteer roles from the listed options.');
  });

  it('rejects a registration without attendees', () => {
    const result = validateRegistration(schema, validRegistration({ attendees: [] }));
    expect(result.ok).toBe(false);
    expect(result.errors.attendees).toBe('Add at least one attendee to continue.');
  });

  it('rejects a missing attendee name', () => {
    const result = validateRegistration(schema, validRegistration({ attendees: [{ name: ' ', ageBand: '11_plus' }] }));
    expect(result.ok).toBe(false);
    expect(result.errors.attendees).toBe('Enter a name for each attendee.');
  });

  it('rejects a WhatsApp number without consent', () => {
    const result = validateRegistration(schema, validRegistration({ whatsappConsent: false }));
    expect(result.ok).toBe(false);
    expect(result.errors.whatsappConsent).toBe('Please agree before we contact you on WhatsApp.');
  });

  it('enforces performance limits by performer count', () => {
    const performance = { title: 'Dance', participantNames: 'Family group', participantCount: 4, durationMinutes: 5, compereIntroduction: 'A traditional dance.' };
    expect(validateRegistration(schema, validRegistration({ performances: [performance] })).ok).toBe(true);
    expect(validateRegistration(schema, validRegistration({ performances: [{ ...performance, participantCount: 1, durationMinutes: 4 }] })).ok).toBe(true);
    expect(validateRegistration(schema, validRegistration({ performances: [{ ...performance, participantCount: 1, durationMinutes: 5 }] })).ok).toBe(false);
    expect(validateRegistration(schema, validRegistration({ performances: [{ ...performance, participantCount: 5, durationMinutes: 7 }] })).ok).toBe(true);
    expect(validateRegistration(schema, validRegistration({ performances: [{ ...performance, participantCount: 5, durationMinutes: 8 }] })).ok).toBe(false);
  });

  it('enforces performer name and count limits on the server', () => {
    const performance = { title: 'Dance', participantNames: 'Family group', participantCount: 2, durationMinutes: 5, compereIntroduction: 'A family dance.' };
    expect(validateRegistration(schema, validRegistration({ performances: [{ ...performance, participantNames: 'A'.repeat(151) }] })).ok).toBe(false);
    expect(validateRegistration(schema, validRegistration({ performances: [{ ...performance, participantCount: 101 }] })).ok).toBe(false);
  });

  it('limits each family to two complete performances', () => {
    const performance = { title: 'Dance', participantNames: 'Family group', participantCount: 4, durationMinutes: 5, compereIntroduction: 'A traditional dance.' };
    expect(validateRegistration(schema, validRegistration({ performances: [performance, performance] })).ok).toBe(true);
    const tooMany = validateRegistration(schema, validRegistration({ performances: [performance, performance, performance] }));
    expect(tooMany.ok).toBe(false);
    expect(tooMany.errors.performances).toBe('A family may register up to two performances. Contact the organizers for more.');
  });

  it('ignores a blank optional performance row and rejects an incomplete one', () => {
    expect(validateRegistration(schema, validRegistration({ performanceTitle: [''] })).ok).toBe(true);
    const incomplete = validateRegistration(schema, validRegistration({
      performances: [{ title: 'Dance', participantNames: '', participantCount: 2, durationMinutes: 5, compereIntroduction: '' }],
    }));
    expect(incomplete.ok).toBe(false);
    expect(incomplete.errors.performances).toBe('Enter the performer or group name.');
  });

  it('normalizes repeated browser form fields into attendees and performances', () => {
    const raw = normalizeRegistrationInput({
      contactName: 'Priya',
      contactEmail: 'priya@example.com',
      mobileCountryCode: '+1',
      mobileNumber: '603-970-0000',
      attendeeName: ['Priya', 'Arun'],
      attendeeAgeBand: ['11_plus', 'under_5'],
      attendeeWilling_0: 'yes',
      attendeeRoles_0: ['music_dj'],
      performanceTitle: ['Dance'],
      performanceParticipants: ['Priya and Arun'],
      performanceParticipantCount: ['2'],
      performanceDuration: ['5'],
      performanceIntroduction: ['A family dance.'],
    });
    expect(raw.attendees).toHaveLength(2);
    expect(raw.attendees[0]).toMatchObject({ willingToVolunteer: true, volunteerRoles: ['music_dj'] });
    expect(raw.performances[0]).toMatchObject({ participantCount: '2', durationMinutes: '5' });
    expect(validateRegistration(schema, raw).ok).toBe(true);
  });

  it('supports an unlisted calling code through the Other option', () => {
    const result = validateRegistration(schema, validRegistration({
      mobileCountryCode: 'other',
      mobileOtherCountryCode: '+34',
      mobileNumber: '6123456780',
    }));
    expect(result.ok).toBe(true);
    expect(result.data.mobileE164).toBe('+346123456780');
  });

  it('rejects invalid numbers and a missing custom calling code', () => {
    for (const mobileNumber of ['12', '603970000', '60397000000']) {
      const invalidNumber = validateRegistration(schema, validRegistration({ mobileNumber }));
      expect(invalidNumber.ok).toBe(false);
      expect(invalidNumber.errors.mobileE164).toBe('Enter a 10-digit mobile number.');
    }
    const invalidWhatsApp = validateRegistration(schema, validRegistration({ whatsappNumber: '987654321' }));
    expect(invalidWhatsApp.ok).toBe(false);
    expect(invalidWhatsApp.errors.whatsappE164).toBe('Enter a 10-digit WhatsApp number.');

    const missingCallingCode = validateRegistration(schema, validRegistration({
      mobileCountryCode: 'other',
      mobileOtherCountryCode: '',
    }));
    expect(missingCallingCode.ok).toBe(false);
    expect(missingCallingCode.errors.mobileE164).toBe('Enter a valid calling code for the mobile number.');
  });
});