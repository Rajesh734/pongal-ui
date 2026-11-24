export const PHONE_COUNTRIES = [
  { code: '+1', label: 'United States (+1)' },
  { code: '+91', label: 'India (+91)' },
  { code: '+44', label: 'United Kingdom (+44)' },
  { code: '+61', label: 'Australia (+61)' },
  { code: '+64', label: 'New Zealand (+64)' },
  { code: '+94', label: 'Sri Lanka (+94)' },
  { code: '+92', label: 'Pakistan (+92)' },
  { code: '+880', label: 'Bangladesh (+880)' },
  { code: '+977', label: 'Nepal (+977)' },
  { code: '+971', label: 'United Arab Emirates (+971)' },
  { code: '+966', label: 'Saudi Arabia (+966)' },
  { code: '+974', label: 'Qatar (+974)' },
  { code: '+65', label: 'Singapore (+65)' },
  { code: '+60', label: 'Malaysia (+60)' },
  { code: '+62', label: 'Indonesia (+62)' },
  { code: '+63', label: 'Philippines (+63)' },
  { code: '+81', label: 'Japan (+81)' },
  { code: '+86', label: 'China (+86)' },
  { code: '+82', label: 'South Korea (+82)' },
  { code: '+49', label: 'Germany (+49)' },
  { code: '+33', label: 'France (+33)' },
  { code: '+39', label: 'Italy (+39)' },
  { code: '+34', label: 'Spain (+34)' },
  { code: '+353', label: 'Ireland (+353)' },
  { code: '+31', label: 'Netherlands (+31)' },
  { code: '+41', label: 'Switzerland (+41)' },
  { code: '+46', label: 'Sweden (+46)' },
  { code: '+47', label: 'Norway (+47)' },
  { code: '+45', label: 'Denmark (+45)' },
  { code: '+27', label: 'South Africa (+27)' },
  { code: '+55', label: 'Brazil (+55)' },
  { code: '+52', label: 'Mexico (+52)' },
  { code: 'other', label: 'Other country code' },
];

const COUNTRY_CODES = PHONE_COUNTRIES.filter((country) => country.code !== 'other')
  .map((country) => country.code)
  .sort((left, right) => right.length - left.length);

export function splitPhoneE164(phone) {
  const value = typeof phone === 'string' ? phone : '';
  if (!value) return { countryCode: '+1', number: '', otherCountryCode: '' };
  const code = COUNTRY_CODES.find((countryCode) => value.startsWith(countryCode));
  if (code) return { countryCode: code, number: value.slice(code.length), otherCountryCode: '' };
  return { countryCode: 'other', number: value.replace(/^\+/, ''), otherCountryCode: '+' };
}