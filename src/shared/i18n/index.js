import { createTranslator } from './translate.js';
import ta from './catalogs/ta.js';
import te from './catalogs/te.js';
import kn from './catalogs/kn.js';
import ml from './catalogs/ml.js';

export const DEFAULT_LOCALE = 'en';

export const LOCALES = [
  { code: 'en', name: 'English' },
  { code: 'ta', name: 'தமிழ்' },
  { code: 'te', name: 'తెలుగు' },
  { code: 'kn', name: 'ಕನ್ನಡ' },
  { code: 'ml', name: 'മലയാളം' },
];

export const CATALOGS = { en: {}, ta, te, kn, ml };

export function isLocale(code) {
  return typeof code === 'string' && Object.hasOwn(CATALOGS, code);
}

export function translatorFor(locale) {
  return createTranslator(CATALOGS[isLocale(locale) ? locale : DEFAULT_LOCALE]);
}
