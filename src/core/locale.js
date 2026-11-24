import { cookieValue } from './csrf.js';
import { DEFAULT_LOCALE, isLocale } from '../shared/i18n/index.js';

export const LOCALE_COOKIE = 'pongal_lang';
export const LANGUAGE_UNAVAILABLE = 'English is selected because that language is unavailable.';

/** Picks the page language from ?lang=, then the saved cookie; saves a valid ?lang= for later visits. */
export function resolveLocale(request, reply, config) {
  const requested = typeof request.query?.lang === 'string' ? request.query.lang : null;
  const saved = cookieValue(request.headers.cookie, LOCALE_COOKIE);
  const candidate = requested ?? saved;
  if (candidate == null || candidate === '') return { locale: DEFAULT_LOCALE, unavailable: false };

  const locale = isLocale(candidate) ? candidate : DEFAULT_LOCALE;
  if (locale !== saved) {
    reply.header(
      'set-cookie',
      `${LOCALE_COOKIE}=${locale}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax${config.NODE_ENV === 'production' ? '; Secure' : ''}`,
    );
  }
  return { locale, unavailable: !isLocale(candidate) };
}
