import { describe, expect, it } from 'vitest';
import { loadEventConfigs } from '../src/core/event-config.js';
import { buildSurveySchema, validateSurvey } from '../src/shared/survey-schema.js';
import { validForm } from './helpers.js';

const { config } = loadEventConfigs().find((e) => e.config.slug === 'pongal-2027');
const schema = buildSurveySchema(config.survey, config.days);

const check = (overrides) => validateSurvey(schema, validForm(overrides));
const errorFor = (field, overrides) => check(overrides).errors?.[field];

it('accepts a valid form', () => {
  const result = check();
  expect(result.ok).toBe(true);
  expect(result.data).toMatchObject({ name: 'Priya', email: 'priya@example.com', mobileE164: null, foodCode: 'veg', consent: true });
});

describe('name and email', () => {
  it('Missing name', () => expect(errorFor('name', { name: ' ' })).toBe('Please enter your name (at least 2 letters).'));

  it('Tamil name accepted', () => {
    const result = check({ name: 'பிரியா Raman' });
    expect(result.ok).toBe(true);
    expect(result.data.name).toBe('பிரியா Raman');
  });

  it('Name with digits', () =>
    expect(errorFor('name', { name: 'Priya123' })).toBe('Please use letters, spaces, apostrophes, periods or hyphens in your name.'));

  it('Name too long', () => expect(errorFor('name', { name: 'a'.repeat(81) })).toBe('Your name can be up to 80 characters.'));

  it('Missing email', () => expect(errorFor('email', { email: '' })).toBe('Please enter your email address.'));

  it('Malformed email', () =>
    expect(errorFor('email', { email: 'priya@gmail' })).toBe("That email doesn't look right. Please check it, e.g. name@example.com."));

  it('Normalised email', () => expect(check({ email: ' Priya@Example.COM ' }).data.email).toBe('priya@example.com'));
});

describe('mobile', () => {
  const invalid = 'Please enter a 10-digit US mobile number, e.g. 617-555-0123.';
  it('Formatted number', () => expect(check({ mobile: '(617) 555-0123' }).data.mobileE164).toBe('+16175550123'));
  it('Country code included', () => expect(check({ mobile: '+1 617.555.0123' }).data.mobileE164).toBe('+16175550123'));
  it('Too few digits', () => expect(errorFor('mobile', { mobile: '617-555-012' })).toBe(invalid));
  it('Invalid area code', () => expect(errorFor('mobile', { mobile: '123-555-0123' })).toBe(invalid));
  it('Left empty', () => {
    const result = check({ mobile: undefined });
    expect(result.ok).toBe(true);
    expect(result.data.mobileE164).toBeNull();
  });
});

describe('days and headcount', () => {
  it('No day selected', () => expect(errorFor('days', { days: undefined })).toBe('Please pick at least one day you could attend.'));

  it('Missing likelihood', () =>
    expect(errorFor('likelihood_2027-01-16', { 'likelihood_2027-01-16': undefined })).toBe(
      'Please tell us how likely you are to attend on Saturday, Jan 16.',
    ));

  it('Stale likelihood ignored', () => {
    const result = check({ days: '2027-01-17', 'likelihood_2027-01-17': 'likely', 'likelihood_2027-01-16': 'definitely' });
    expect(result.data.days).toEqual([{ date: '2027-01-17', likelihood: 'likely' }]);
  });

  it('No adults', () =>
    expect(errorFor('headcount_adult_11_plus', { headcount_adult_11_plus: '0' })).toBe('Adults & kids 11+ must be between 1 and 10.'));

  it('Too many kids', () => expect(errorFor('headcount_kids_5_10', { headcount_kids_5_10: '11' })).toBe('Please enter a number from 0 to 10.'));

  it('Not a whole number', () => expect(errorFor('headcount_kids_under_5', { headcount_kids_under_5: '1.5' })).toBe('Please enter a whole number.'));

  it('Group too large', () =>
    expect(errorFor('headcount', { headcount_adult_11_plus: '8', headcount_kids_5_10: '5', headcount_kids_under_5: '3' })).toBe(
      "That's a large group. For more than 15 people, please contact the organizers.",
    ));

  it('Blank kids fields', () => {
    const result = check({ headcount_kids_5_10: '', headcount_kids_under_5: undefined });
    expect(result.data.headcounts).toEqual([
      { code: 'adult_11_plus', count: 2 },
      { code: 'kids_5_10', count: 0 },
      { code: 'kids_under_5', count: 0 },
    ]);
  });
});

describe('choices, comments and consent', () => {
  it('Missing food preference', () => expect(errorFor('food', { food: undefined })).toBe('Please choose a food preference.'));
  it('Missing cultural interest', () =>
    expect(errorFor('cultural', { cultural: undefined })).toBe("Please tell us if you're interested in a cultural performance."));
  it('Missing contribution', () =>
    expect(errorFor('contribution', { contribution: undefined })).toBe("Please choose a contribution amount you're comfortable with."));
  it('Tampered role', () => expect(errorFor('roles', { roles: ['cleanup', 'dj'] })).toBe('Please choose from the listed volunteer roles.'));
  it('Comments too long', () =>
    expect(errorFor('comments', { comments: 'x'.repeat(534) })).toBe('Comments can be up to 500 characters (you have 534).'));
  it('Consent not given', () =>
    expect(errorFor('consent', { consent: undefined })).toBe('Please agree so organizers can contact you about the event.'));
});
