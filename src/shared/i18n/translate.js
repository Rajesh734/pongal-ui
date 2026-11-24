// Shared by the server and the browser: keep it free of Node-only imports.
// Catalog keys are the English text itself; a missing key falls back to English.

export function format(template, vars) {
  return vars ? template.replace(/\{(\w+)\}/g, (match, name) => (name in vars ? String(vars[name]) : match)) : template;
}

export function createTranslator(catalog = {}) {
  return (key, vars) => format(catalog[key] ?? key, vars);
}
