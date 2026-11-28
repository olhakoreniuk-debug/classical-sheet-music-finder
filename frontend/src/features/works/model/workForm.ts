// Form model for adding a work: values <-> CreateWorkRequest, and API field
// errors -> form fields. Pure functions: no React, no fetching.
import type { CreateWorkRequest, FieldError } from '../../../api/types';

export interface WorkFormValues {
  title: string;
  composerName: string;
  catalogueNumber: string;
  pageUrl: string;
}

export type WorkFormField = keyof WorkFormValues;

export const FORM_FIELDS: readonly WorkFormField[] = ['title', 'composerName', 'catalogueNumber', 'pageUrl'];

export const FIELD_LABELS: Record<WorkFormField, string> = {
  title: 'Title',
  composerName: 'Composer',
  catalogueNumber: 'Catalogue number',
  pageUrl: 'Page URL',
};

export const EMPTY_WORK_FORM: WorkFormValues = { title: '', composerName: '', catalogueNumber: '', pageUrl: '' };

const optional = (value: string): string | null => (value.trim() === '' ? null : value);

/**
 * The title is sent as typed so the API can report blank titles. Empty optional
 * fields are sent as null (an empty string would be invalid in the contract).
 */
export function toCreateWorkRequest(values: WorkFormValues): CreateWorkRequest {
  return {
    title: values.title,
    composerName: optional(values.composerName),
    catalogueNumber: optional(values.catalogueNumber),
    pageUrl: optional(values.pageUrl),
  };
}

export interface MappedFieldErrors {
  byField: Partial<Record<WorkFormField, string[]>>;
  /** Errors that do not belong to one form field (e.g. headers). */
  general: string[];
}

function fieldFromPointer(error: FieldError): WorkFormField | null {
  if (error.location !== 'body') return null;
  const name = error.field.replace(/^\//, '');
  return (FORM_FIELDS as readonly string[]).includes(name) ? (name as WorkFormField) : null;
}

/** Assigns each FieldError from a Problem Details response to its form field. */
export function mapFieldErrors(errors: readonly FieldError[]): MappedFieldErrors {
  const result: MappedFieldErrors = { byField: {}, general: [] };
  for (const error of errors) {
    const field = fieldFromPointer(error);
    if (field) (result.byField[field] ??= []).push(error.message);
    else result.general.push(error.message);
  }
  return result;
}
