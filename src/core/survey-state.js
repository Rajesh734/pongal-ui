/** Returns 'not_open', 'open' or 'closed' for an event row at instant `now`. */
export function surveyState(event, now = new Date()) {
  if (now < event.surveyOpensAt) return 'not_open';
  if (now < event.surveyClosesAt) return 'open';
  return 'closed';
}
