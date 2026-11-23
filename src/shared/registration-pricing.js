const PRICE_KEYS = { '11_plus': 'age_11_plus', '5_to_10': 'age_5_to_10', under_5: 'under_5' };

export function feeForAgeBand(ageBand, prices) {
  return prices[PRICE_KEYS[ageBand]];
}

export function calculateFamilyTotal(attendees, prices) {
  return attendees.reduce((total, attendee) => total + (feeForAgeBand(attendee.ageBand, prices) ?? 0), 0);
}

export function summarizeAgeBands(attendees, prices) {
  const summary = {
    age_11_plus: { count: 0, subtotalCents: 0 },
    age_5_to_10: { count: 0, subtotalCents: 0 },
    under_5: { count: 0, subtotalCents: 0 },
  };
  for (const attendee of attendees) {
    const key = PRICE_KEYS[attendee.ageBand];
    if (!key) continue;
    summary[key].count += 1;
    summary[key].subtotalCents += prices[key];
  }
  return summary;
}