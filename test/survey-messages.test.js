import { expect, it } from 'vitest';
import { loadEventConfigs } from '../src/core/event-config.js';
import { messages as m } from '../src/shared/survey-messages.js';

const { config } = loadEventConfigs().find((e) => e.config.slug === 'pongal-2027');
const { survey } = config;

it('renders every survey message for the Pongal 2027 config', () => {
  const rendered = {};
  for (const [key, value] of Object.entries(m)) {
    if (typeof value === 'string') rendered[key] = value;
  }
  for (const day of config.days) {
    rendered[`likelihoodRequired ${day.date}`] = m.likelihoodRequired(day.label);
    rendered[`likelihoodQuestion ${day.date}`] = m.likelihoodQuestion(day.label);
  }
  for (const band of survey.headcount_bands) rendered[`headcountRange ${band.code}`] = m.headcountRange(band);
  Object.assign(rendered, {
    groupTooLarge: m.groupTooLarge(survey.max_total_people),
    commentsTooLong: m.commentsTooLong(survey.comments_max, 534),
    commentsCounter: m.commentsCounter(120, survey.comments_max),
    consentText: m.consentText(config.name),
    errorSummary1: m.errorSummary(1),
    errorSummary2: m.errorSummary(2),
    notOpen: m.notOpen(config.name, 'Friday, November 20 at 8:00 PM ET'),
    savedNew: m.savedNew('Priya', config.name),
    savedUpdated: m.savedUpdated('Priya', config.name),
    saveLink: m.saveLink('Tuesday, November 24 at 11:59 PM ET'),
    emailed: m.emailed('priya@example.com'),
    emailSubject: m.emailSubject(config.name),
    closedMessage: survey.closed_message,
  });
  expect(rendered).toMatchSnapshot();

  // Exact texts from the specs.
  expect(rendered['headcountRange adult_11_plus']).toBe('Adults & kids 11+ must be between 1 and 10.');
  expect(rendered['headcountRange kids_5_10']).toBe('Please enter a number from 0 to 10.');
  expect(rendered.commentsCounter).toBe('120 / 500');
  expect(rendered.consentText).toBe(
    "I agree that organizers may contact me by email, phone or WhatsApp about Pongal 2027. My details are visible only to organizers and won't be shared.",
  );
  expect(rendered.notOpen).toBe('The Pongal 2027 interest survey opens on Friday, November 20 at 8:00 PM ET.');
  expect(rendered.errorSummary2).toBe('Please fix the 2 highlighted fields below.');
  expect(rendered.emailSubject).toBe('Your Pongal 2027 survey link');
});
