import { pageTranslator } from '/shared/i18n/browser.js';

const t = await pageTranslator();
const selectors = 'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="radio"]), select, textarea';
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const e164Pattern = /^\+[1-9][0-9]{10,12}$/;
const otherCallingCodePattern = /^\+[1-9][0-9]{0,2}$/;

function labelFor(field) {
  return field.labels?.[0]?.textContent?.trim().replace(/\s+/g, ' ').toLowerCase() || t('this field');
}

function phoneValue(field) {
  if (field.name.endsWith('E164')) return field.value.trim();
  const prefix = field.name.startsWith('whatsapp') ? 'whatsapp' : 'mobile';
  const callingCode = document.querySelector(`#${prefix}CountryCode`)?.value ?? '+1';
  const otherCode = document.querySelector(`#${prefix}OtherCountryCode`)?.value.trim() ?? '';
  const code = callingCode === 'other' ? otherCode : callingCode;
  return `${code}${field.value.replace(/\D/g, '')}`;
}

function messageFor(field) {
  if (field.disabled || field.closest('[hidden]')) return '';
  if (field.type === 'checkbox') return field.required && !field.checked ? t('Confirm {label}.', { label: labelFor(field) }) : '';
  const value = field.value.trim();
  const label = labelFor(field);
  const performance = field.closest('.performance-row');
  const performanceHasValues = performance && [...performance.querySelectorAll(selectors)].some((input) => input.value.trim() !== '');

  if (field.required && !value) {
    return field.tagName === 'SELECT' ? t('Choose {label}.', { label }) : t('Enter {label}.', { label });
  }
  if (!value && !performanceHasValues) return '';
  if (performanceHasValues && performance?.contains(field) && !value) return t('Complete {label} or remove this performance.', { label });
  if (field.type === 'email' && value && !emailPattern.test(value)) return t('Enter a valid email address, such as name@example.com.');
  if (field.name === 'mobileNumber' || field.name === 'whatsappNumber' || field.name.endsWith('E164')) {
    if (value && (field.name.endsWith('E164') ? !e164Pattern.test(phoneValue(field)) : !/^\d{10}$/.test(value))) {
      return t('Enter exactly 10 digits for the phone number.');
    }
  }
  if (field.name.endsWith('OtherCountryCode') && value && !otherCallingCodePattern.test(value)) {
    return t('Enter a country calling code, such as +34.');
  }
  if (field.minLength > 0 && value.length < field.minLength) return t('Enter at least {n} characters for {label}.', { n: field.minLength, label });
  if (field.maxLength > 0 && value.length > field.maxLength) return t('Use no more than {n} characters for {label}.', { n: field.maxLength, label });
  if (field.validity.rangeUnderflow) return t('Enter a value of at least {n}.', { n: field.min });
  if (field.validity.rangeOverflow) return t('Enter a value no greater than {n}.', { n: field.max });
  if (field.validity.stepMismatch || field.validity.badInput) return t('Enter a valid number for {label}.', { label });
  if (field.validity.typeMismatch || field.validity.patternMismatch) return t('Enter a valid {label}.', { label });
  return '';
}

function errorElement(field) {
  const identifier = field.id || field.name;
  const scope = field.closest('form') ?? field.parentElement;
  const existing = scope.querySelector(`[data-validation-error-for="${CSS.escape(identifier)}"]`);
  if (existing) return existing;
  const error = document.createElement('p');
  error.className = 'field-error';
  error.dataset.validationErrorFor = identifier;
  error.id = `${identifier}-validation-error`;
  error.setAttribute('aria-live', 'polite');
  const target = field.type === 'checkbox' ? field.closest('.choice') ?? field : field;
  target.insertAdjacentElement('afterend', error);
  const describedBy = new Set((field.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean));
  describedBy.add(error.id);
  field.setAttribute('aria-describedby', [...describedBy].join(' '));
  return error;
}

function validate(field) {
  if (field.type === 'checkbox' && !field.required) return true;
  const message = messageFor(field);
  field.setAttribute('aria-invalid', message ? 'true' : 'false');
  const error = errorElement(field);
  error.textContent = message;
  error.hidden = !message;
  return !message;
}

function validateConditionalGroups(form, { submitting = false } = {}) {
  let valid = true;
  for (const row of form.querySelectorAll('.attendee-row')) {
    const willing = row.querySelector('input[name^="attendeeWilling_"]');
    const roles = row.querySelectorAll('input[name^="attendeeRoles_"]:checked');
    const volunteer = row.querySelector('.attendee-volunteer');
    if (!willing || !volunteer) continue;
    let error = volunteer.querySelector('[data-volunteer-error]');
    if (!error) {
      error = document.createElement('p');
      error.className = 'field-error';
      error.dataset.volunteerError = '';
      error.setAttribute('aria-live', 'polite');
      error.hidden = true;
      volunteer.append(error);
    }
    const missingRole = willing.checked && roles.length === 0;
    if (!missingRole) {
      error.hidden = true;
      error.textContent = '';
      delete error.dataset.shown;
    } else if (submitting || error.dataset.shown) {
      error.textContent = t('Choose at least one volunteer role or clear willing to volunteer.');
      error.hidden = false;
      error.dataset.shown = 'true';
    }
    if (missingRole) valid = false;
  }
  const whatsapp = form.querySelector('[name="whatsappNumber"]');
  const whatsappSame = form.querySelector('[name="whatsappSameAsMobile"]');
  const consent = form.querySelector('[name="whatsappConsent"]');
  if (consent) {
    const error = errorElement(consent);
    if (error.dataset.groupValidation === 'whatsapp') {
      error.textContent = '';
      error.hidden = true;
      error.dataset.groupValidation = '';
      consent.setAttribute('aria-invalid', 'false');
    }
    if ((whatsappSame?.checked || (!whatsapp?.disabled && whatsapp?.value.trim())) && !consent.checked) {
      error.textContent = t('Agree before organizers contact you on WhatsApp.');
      error.hidden = false;
      error.dataset.groupValidation = 'whatsapp';
      consent.setAttribute('aria-invalid', 'true');
      valid = false;
    }
  }
  return valid;
}

document.querySelectorAll('form[data-validate-on-blur]').forEach((form) => {
  form.addEventListener('focusout', (event) => {
    if (event.target.matches(selectors) && event.relatedTarget?.matches(selectors)) validate(event.target);
    validateConditionalGroups(form);
  });
  form.addEventListener('input', (event) => {
    if (event.target.matches(selectors) && event.target.dataset.validationTouched) validate(event.target);
    if (event.target.matches(selectors)) event.target.dataset.validationTouched = 'true';
    validateConditionalGroups(form);
  });
  form.addEventListener('change', (event) => {
    if (event.target.matches(selectors) && event.target.dataset.validationTouched) validate(event.target);
    if (event.target.matches('input[name^="attendeeRoles_"]') && !event.target.checked) {
      const error = event.target.closest('.attendee-volunteer')?.querySelector('[data-volunteer-error]');
      if (error) error.dataset.shown = 'true';
    }
    validateConditionalGroups(form);
  });
  form.addEventListener('submit', (event) => {
    const fields = [...form.querySelectorAll(selectors)].filter((field) => !field.disabled && !field.closest('[hidden]'));
    const firstInvalid = fields.find((field) => !validate(field));
    if (!validateConditionalGroups(form, { submitting: true }) || firstInvalid) {
      event.preventDefault();
      (firstInvalid ?? form.querySelector('[data-volunteer-error]:not([hidden])')?.closest('.attendee-volunteer')?.querySelector('input'))?.focus();
    }
  });
});