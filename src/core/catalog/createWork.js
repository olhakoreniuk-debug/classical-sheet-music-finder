// Use case: add a work manually (POST /works, ADR-0002).
//
// Domain rules the contract cannot express: values are trimmed; a value that
// is blank after trimming is rejected (null or omitted means "unknown"); limits
// are checked on the trimmed value; the page URL must be http(s). The work
// always belongs to the source 'manual'. Duplicate page URLs (any source,
// compared with pageUrlKey) and composer reuse (exact name) are enforced
// atomically by the WorkCommands port, which throws DuplicatePageUrlError.

import { WorkValidationError } from '../errors.js';
import { pageUrlKey } from './pageUrl.js';

const FIELDS = [
  { name: 'title', label: 'Title', max: 500, required: true },
  { name: 'composerName', label: 'Composer name', max: 200 },
  { name: 'catalogueNumber', label: 'Catalogue number', max: 100 },
  { name: 'pageUrl', label: 'Page URL', max: 2000 },
];

const fieldError = (field, code, message) => ({ location: 'body', field: `/${field}`, code, message });

/**
 * @param {{ workCommands: import('../ports.js').WorkCommands }} deps
 * @param {{ title: string, composerName?: string | null, catalogueNumber?: string | null, pageUrl?: string | null }} input
 * @returns {Promise<import('../ports.js').Work>} the created work
 * @throws {WorkValidationError | import('../errors.js').DuplicatePageUrlError}
 */
export async function createWork({ workCommands }, input) {
  const values = {};
  const errors = [];

  for (const { name, label, max, required } of FIELDS) {
    const raw = input?.[name];
    if (raw === undefined || raw === null) {
      if (required) errors.push(fieldError(name, 'required', `${label} is required.`));
      values[name] = null;
      continue;
    }
    if (typeof raw !== 'string') {
      errors.push(fieldError(name, 'invalid_type', `${label} must be text.`));
      continue;
    }
    const trimmed = raw.trim();
    if (trimmed === '') {
      errors.push(fieldError(name, 'blank', `${label} must contain at least one non-space character.`));
    } else if (trimmed.length > max) {
      errors.push(fieldError(name, 'too_long', `${label} must be at most ${max} characters.`));
    }
    values[name] = trimmed;
  }

  if (values.pageUrl && !/^https?:\/\/\S/i.test(values.pageUrl)) {
    errors.push(fieldError('pageUrl', 'invalid_format', 'Page URL must be an http or https URL.'));
  }
  if (errors.length > 0) throw new WorkValidationError(errors);

  return workCommands.createManualWork({
    title: values.title,
    composerName: values.composerName,
    catalogueNumber: values.catalogueNumber,
    pageUrl: values.pageUrl,
    pageUrlKey: pageUrlKey(values.pageUrl),
  });
}
