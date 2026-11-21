// Progressive enhancement for the survey pages (design D3). Without this file the forms still work:
// the server validates with the same shared schema and messages.
import Alpine from '/vendor/alpine-csp.mjs';
import { messages as m } from '/shared/survey-messages.js';
import { buildSurveySchema, validateSurvey } from '/shared/survey-schema.js';

const configEl = document.getElementById('survey-config');
const cfg = configEl ? JSON.parse(configEl.textContent) : null;
const schema = cfg ? buildSurveySchema(cfg.survey, cfg.days) : null;
const MULTI = ['days', 'roles'];

function readForm(form) {
  const data = new FormData(form);
  const raw = {};
  for (const [key, value] of data) if (!MULTI.includes(key)) raw[key] = value;
  for (const key of MULTI) raw[key] = data.getAll(key);
  if (cfg.mode === 'edit') raw.email = cfg.email;
  return raw;
}

function setError(key, message) {
  const el = document.getElementById(`${key}-error`);
  if (!el) return;
  el.textContent = message ?? '';
  el.hidden = !message;
  const input = document.getElementById(key);
  if (input) {
    if (message) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  }
}

const isShown = (key) => {
  const el = document.getElementById(`${key}-error`);
  return Boolean(el && !el.hidden);
};

/** Error keys a field's checks belong to: its name, plus the group total for headcounts. */
const keysFor = (name) => (name.startsWith('headcount_') ? [name, 'headcount'] : [name]);

Alpine.data('surveyForm', () => ({
  init() {
    this.updateDays();
    this.updateCounter();
  },

  errors() {
    const result = validateSurvey(schema, readForm(this.$el));
    return result.ok ? {} : result.errors;
  },

  check(name, onlyIfShown) {
    const errors = this.errors();
    for (const key of keysFor(name)) {
      if (!onlyIfShown || isShown(key)) setError(key, errors[key]);
    }
  },

  onBlur(event) {
    const field = event.target;
    if (!field.name || field.name === 'website') return;
    // For checkbox and radio groups, wait until focus leaves the whole group.
    const group = field.closest('fieldset');
    if ((field.type === 'checkbox' || field.type === 'radio') && group && group.contains(event.relatedTarget)) return;
    this.check(field.name, false);
  },

  onChange(event) {
    const { name } = event.target;
    if (name === 'days') this.updateDays();
    if (name) this.check(name, true);
  },

  onInput(event) {
    const { name } = event.target;
    if (name === 'comments') this.updateCounter();
    if (name) this.check(name, true);
  },

  onSubmit(event) {
    const errors = this.errors();
    const summary = document.getElementById('error-summary');
    document.querySelectorAll('p.error[id$="-error"]').forEach((el) => {
      const key = el.id.replace(/-error$/, '');
      setError(key, errors[key]);
    });
    const count = Object.keys(errors).length;
    if (!count) return;
    event.preventDefault();
    summary.textContent = m.errorSummary(count);
    summary.hidden = false;
    summary.focus();
  },

  updateDays() {
    const ticked = new FormData(this.$el).getAll('days');
    this.$el.querySelectorAll('fieldset.likelihood').forEach((fs) => {
      fs.hidden = !ticked.includes(fs.dataset.day);
      if (fs.hidden) setError(`likelihood_${fs.dataset.day}`, null);
    });
  },

  updateCounter() {
    const comments = document.getElementById('comments');
    const counter = document.getElementById('comments-counter');
    if (comments && counter) counter.textContent = m.commentsCounter(comments.value.trim().length, cfg.survey.comments_max);
  },
}));

Alpine.data('copyLink', () => ({
  init() {
    if (navigator.clipboard) this.$el.querySelector('button[data-link]').hidden = false;
  },

  copy(event) {
    const status = document.getElementById('copy-status');
    navigator.clipboard.writeText(event.currentTarget.dataset.link).then(
      () => {
        status.textContent = 'Link copied.';
      },
      () => {
        status.textContent = 'Could not copy. Please press and hold the link to copy it.';
      },
    );
  },
}));

Alpine.start();
