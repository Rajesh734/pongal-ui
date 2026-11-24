const E164 = /^\+[1-9][0-9]{7,14}$/;

/** US numbers as 617-555-0123; others unchanged. Plain text in Excel and never a formula. */
export function formatPhone(value) {
  if (!value) return '';
  const us = /^\+1([2-9][0-9]{2})([0-9]{3})([0-9]{4})$/.exec(value);
  return us ? `${us[1]}-${us[2]}-${us[3]}` : value;
}

/** Quotes every cell; prefixes a quote to text a spreadsheet could run as a formula. */
export function csvCell(value) {
  let text = value == null ? '' : String(value);
  // A validated phone number cannot be a formula, so it keeps its leading +.
  if (!E164.test(text) && /^[\t\r ]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

/** UTF-8 BOM (so Excel reads Tamil names), CRLF lines. */
export function toCsv(records) {
  return `\uFEFF${records.map((record) => record.map(csvCell).join(',')).join('\r\n')}`;
}
