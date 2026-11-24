import { calculateFamilyTotal, summarizeAgeBands } from '/shared/registration-pricing.js';
import { pageTranslator } from '/shared/i18n/browser.js';

const t = await pageTranslator();

const list = document.querySelector('#attendee-list');
const template = document.querySelector('#attendee-template');
const addButton = document.querySelector('#add-attendee');
const familySummary = document.querySelector('#family-summary');

for (const prefix of ['mobile', 'whatsapp']) {
  const countryCode = document.querySelector(`#${prefix}CountryCode`);
  const otherCountryCode = document.querySelector(`#${prefix}OtherCountryCode`);
  const otherLabel = document.querySelector(`label[for="${prefix}OtherCountryCode"]`);
  if (!countryCode || !otherCountryCode || !otherLabel) continue;

  const updateOtherCountryCode = () => {
    const isOther = countryCode.value === 'other';
    otherCountryCode.hidden = !isOther;
    otherLabel.hidden = !isOther;
    otherCountryCode.required = isOther;
  };

  countryCode.addEventListener('change', updateOtherCountryCode);
  updateOtherCountryCode();
}

// Closed selects show just the calling code; the open list shows full country names.
for (const select of document.querySelectorAll('select[data-short-label]')) {
  for (const option of select.options) option.dataset.full = option.textContent;
  const shorten = () => {
    for (const option of select.options) {
      option.textContent = option.selected ? (option.value.startsWith('+') ? option.value : t('Other')) : option.dataset.full;
    }
  };
  const expand = () => {
    for (const option of select.options) option.textContent = option.dataset.full;
  };
  select.addEventListener('pointerdown', expand);
  select.addEventListener('keydown', (event) => { if (!['Tab', 'Shift'].includes(event.key)) expand(); });
  select.addEventListener('change', shorten);
  select.addEventListener('blur', shorten);
  shorten();
}

const whatsappSame = document.querySelector('#whatsappSameAsMobile');
const whatsappFields = document.querySelector('[data-whatsapp-fields]');
if (whatsappSame && whatsappFields) {
  const updateWhatsapp = () => {
    whatsappFields.hidden = whatsappSame.checked;
    whatsappFields.querySelectorAll('input, select').forEach((input) => { input.disabled = whatsappSame.checked; });
  };
  whatsappSame.addEventListener('change', updateWhatsapp);
  updateWhatsapp();
}

function updateFamilySummary() {
  if (!familySummary || !list) return;
  const prices = JSON.parse(familySummary.dataset.prices);
  const attendees = [...list.querySelectorAll('.attendee-row')].map((row) => ({
    ageBand: row.querySelector('[name="attendeeAgeBand"]').value,
  }));
  const summary = summarizeAgeBands(attendees, prices);
  for (const [band, values] of Object.entries(summary)) {
    familySummary.querySelector(`[data-count="${band}"]`).textContent = String(values.count);
    familySummary.querySelector(`[data-subtotal="${band}"]`).textContent = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(values.subtotalCents / 100);
  }
  familySummary.querySelector('#family-total').textContent = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(calculateFamilyTotal(attendees, prices) / 100);
}

if (list && template && addButton) {
  let nextIndex = list.querySelectorAll('.attendee-row').length;

  const updateRows = () => {
    const rows = [...list.querySelectorAll('.attendee-row')];
    rows.forEach((row, position) => {
      row.querySelector('legend').textContent = t('Attendee {n}', { n: position + 1 });
      const removeButton = row.querySelector('[data-remove-attendee]');
      removeButton.disabled = position === 0;
      removeButton.hidden = position === 0;

      const name = row.querySelector('input[name="attendeeName"]');
      const ageBand = row.querySelector('[name="attendeeAgeBand"]');
      name.id = `attendeeName${position}`;
      name.minLength = position === 0 ? 2 : 1;
      name.previousElementSibling.htmlFor = name.id;
      if (ageBand.tagName === 'SELECT') {
        ageBand.id = `attendeeAgeBand${position}`;
        ageBand.previousElementSibling.htmlFor = ageBand.id;
      }
      row.querySelector('input[name^="attendeeWilling_"]').name = `attendeeWilling_${position}`;
      row.querySelectorAll('input[name^="attendeeRoles_"]').forEach((input) => {
        input.name = `attendeeRoles_${position}`;
      });
      row.querySelector('legend').textContent = position === 0 ? t('Primary contact and attendee 1') : t('Attendee {n}', { n: position + 1 });
      updateVolunteerEligibility(row);
    });
    updateFamilySummary();
  };

  addButton.addEventListener('click', () => {
    const html = template.innerHTML
      .replaceAll('__INDEX_DISPLAY__', String(nextIndex + 1))
      .replaceAll('__INDEX__', String(nextIndex));
    list.insertAdjacentHTML('beforeend', html);
    nextIndex += 1;
    updateRows();
    list.lastElementChild.querySelector('input[name="attendeeName"]').focus();
  });

  list.addEventListener('click', (event) => {
    const removeButton = event.target.closest('[data-remove-attendee]');
    if (!removeButton || list.querySelectorAll('.attendee-row').length === 1) return;
    removeButton.closest('.attendee-row').remove();
    updateRows();
  });

  list.addEventListener('change', (event) => {
    if (event.target.matches('input[name^="attendeeWilling_"]') && !event.target.checked) {
      event.target.closest('.attendee-volunteer').querySelectorAll('input[name^="attendeeRoles_"]').forEach((input) => { input.checked = false; });
    }
    if (event.target.matches('select[name="attendeeAgeBand"]')) {
      updateVolunteerEligibility(event.target.closest('.attendee-row'));
      updateFamilySummary();
    }
  });

  updateRows();
}

function updateVolunteerEligibility(row) {
  if (!row) return;
  const eligible = row.querySelector('[name="attendeeAgeBand"]').value === '11_plus';
  const volunteer = row.querySelector('.attendee-volunteer');
  volunteer.hidden = !eligible;
  volunteer.querySelectorAll('input').forEach((input) => {
    input.disabled = !eligible;
    if (!eligible) input.checked = false;
  });
}

const performanceList = document.querySelector('#performance-list');
const performanceTemplate = document.querySelector('#performance-template');
const addPerformanceButton = document.querySelector('#add-performance');

if (performanceList && performanceTemplate && addPerformanceButton) {
  const maximum = Number(performanceList.dataset.maxPerformances);
  const { limitSolo, limitSmall, limitLarge } = performanceList.dataset;
  let nextIndex = performanceList.querySelectorAll('.performance-row').length;

  const updateDurationLimit = (row) => {
    const count = Number(row.querySelector('[name="performanceParticipantCount"]').value);
    const duration = row.querySelector('[name="performanceDuration"]');
    const hint = row.querySelector('[data-duration-hint]');
    if (!count) {
      duration.max = limitLarge;
      hint.textContent = t('Enter performers to see the time limit.');
      return;
    }
    const [limit, group] = count === 1 ? [limitSolo, t('a solo')] : count <= 4 ? [limitSmall, t('2-4 performers')] : [limitLarge, t('5 or more performers')];
    duration.max = limit;
    hint.textContent = t('Up to {limit} minutes for {group}.', { limit, group });
  };

  const updatePerformances = () => {
    const rows = [...performanceList.querySelectorAll('.performance-row')];
    rows.forEach((row, position) => {
      row.querySelector('legend').textContent = t('Performance {n}', { n: position + 1 });
      for (const field of ['performanceTitle', 'performanceParticipants', 'performanceParticipantCount', 'performanceDuration', 'performanceIntroduction']) {
        const input = row.querySelector(`[name="${field}"]`);
        input.id = `${field}${position}`;
        input.closest('.form-control').querySelector('label').htmlFor = input.id;
      }
      updateDurationLimit(row);
    });
    addPerformanceButton.hidden = rows.length >= maximum;
    addPerformanceButton.disabled = rows.length >= maximum;
  };

  performanceList.addEventListener('input', (event) => {
    if (event.target.matches('[name="performanceParticipantCount"]')) updateDurationLimit(event.target.closest('.performance-row'));
  });

  addPerformanceButton.addEventListener('click', () => {
    if (performanceList.querySelectorAll('.performance-row').length >= maximum) return;
    const html = performanceTemplate.innerHTML
      .replaceAll('__INDEX_DISPLAY__', String(nextIndex + 1))
      .replaceAll('__INDEX__', String(nextIndex));
    performanceList.insertAdjacentHTML('beforeend', html);
    nextIndex += 1;
    updatePerformances();
    performanceList.lastElementChild.querySelector('[name="performanceTitle"]').focus();
  });

  performanceList.addEventListener('click', (event) => {
    const removeButton = event.target.closest('[data-remove-performance]');
    if (!removeButton) return;
    removeButton.closest('.performance-row').remove();
    updatePerformances();
  });

  updatePerformances();
}