// Development-only: reproduces the validation rules of POST /works in openapi.yaml
// (and ADR-0002) so the form's error handling can be shown without the server.
// The real server remains the authority.
import type { CreateWorkRequest, FieldError } from '../api/types';

const LIMITS = { title: 500, composerName: 200, catalogueNumber: 100, pageUrl: 2000 } as const;
const KNOWN_FIELDS = new Set(['title', 'composerName', 'catalogueNumber', 'pageUrl']);

export interface NormalisedWork {
  title: string;
  composerName: string | null;
  catalogueNumber: string | null;
  pageUrl: string | null;
}

export type ValidationResult =
  | { ok: true; value: NormalisedWork }
  | { ok: false; errors: FieldError[] };

function bodyError(field: string, code: string, message: string): FieldError {
  return { location: 'body', field: `/${field}`, code, message };
}

function optionalText(
  raw: unknown,
  field: keyof typeof LIMITS,
  label: string,
  errors: FieldError[],
): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'string') {
    errors.push(bodyError(field, 'invalid_type', `${label} must be text or null.`));
    return null;
  }
  const value = raw.trim();
  if (value === '') {
    errors.push(bodyError(field, 'blank', `${label} must contain at least one non-space character, or be left empty.`));
    return null;
  }
  if (value.length > LIMITS[field]) {
    errors.push(bodyError(field, 'too_long', `${label} must be at most ${LIMITS[field]} characters.`));
  }
  return value;
}

export function validateCreateWork(body: CreateWorkRequest): ValidationResult {
  const errors: FieldError[] = [];

  for (const field of Object.keys(body)) {
    if (!KNOWN_FIELDS.has(field)) errors.push(bodyError(field, 'unknown_field', `${field} is not a known field.`));
  }

  let title = '';
  if (typeof body.title !== 'string') {
    errors.push(bodyError('title', 'required', 'Title is required.'));
  } else {
    title = body.title.trim();
    if (title === '') errors.push(bodyError('title', 'blank', 'Title must contain at least one non-space character.'));
    else if (title.length > LIMITS.title) errors.push(bodyError('title', 'too_long', `Title must be at most ${LIMITS.title} characters.`));
  }

  const composerName = optionalText(body.composerName, 'composerName', 'Composer name', errors);
  const catalogueNumber = optionalText(body.catalogueNumber, 'catalogueNumber', 'Catalogue number', errors);
  const pageUrl = optionalText(body.pageUrl, 'pageUrl', 'Page URL', errors);

  if (pageUrl !== null && !errors.some((e) => e.field === '/pageUrl')) {
    let valid = false;
    try {
      const url = new URL(pageUrl);
      valid = url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      valid = false;
    }
    if (!valid) errors.push(bodyError('pageUrl', 'invalid_format', 'Page URL must be an http or https URL.'));
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: { title, composerName, catalogueNumber, pageUrl } };
}

/** URLs are compared after trimming and percent-decoding (ADR-0002). */
export function comparableUrl(url: string): string {
  try {
    return decodeURI(url.trim());
  } catch {
    return url.trim();
  }
}
