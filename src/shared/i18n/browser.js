import { createTranslator } from './translate.js';

/** Translator for the page language (<html lang>); loads only that language's catalog. */
export async function pageTranslator() {
  const lang = document.documentElement.lang;
  if (!/^[a-z]{2}$/.test(lang) || lang === 'en') return createTranslator();
  try {
    return createTranslator((await import(`./catalogs/${lang}.js`)).default);
  } catch {
    return createTranslator();
  }
}
