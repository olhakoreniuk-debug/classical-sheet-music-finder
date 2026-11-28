// Form for POST /works. The API is the authority on validation: its field errors
// (Problem Details `errors`) are shown next to each field and in a summary.
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { describeError, isApiError } from '../../../api/apiError';
import type { Work } from '../../../api/types';
import { TextField } from '../../../components/TextField';
import controls from '../../../styles/controls.module.css';
import { useCreateWork } from '../hooks/useCreateWork';
import {
  EMPTY_WORK_FORM,
  FIELD_LABELS,
  FORM_FIELDS,
  mapFieldErrors,
  toCreateWorkRequest,
  type MappedFieldErrors,
  type WorkFormField,
  type WorkFormValues,
} from '../model/workForm';
import styles from './WorkForm.module.css';

const FIELD_IDS: Record<WorkFormField, string> = {
  title: 'work-title-input',
  composerName: 'work-composer-input',
  catalogueNumber: 'work-catalogue-input',
  pageUrl: 'work-page-url-input',
};

const NO_ERRORS: MappedFieldErrors = { byField: {}, general: [] };

function errorsFromFailure(error: unknown): MappedFieldErrors {
  if (!isApiError(error)) return { byField: {}, general: [describeError(error)] };
  if (error.status === 422) return mapFieldErrors(error.fieldErrors);
  if (error.status === 409) return { byField: { pageUrl: [error.message] }, general: [] };
  if (error.status === 403) return { byField: {}, general: ['Adding works is disabled on this server.'] };
  return { byField: {}, general: [describeError(error)] };
}

interface WorkFormProps {
  onCreated: (work: Work) => void;
}

export function WorkForm({ onCreated }: WorkFormProps) {
  const { submit, submitting } = useCreateWork();
  const [values, setValues] = useState<WorkFormValues>(EMPTY_WORK_FORM);
  const [errors, setErrors] = useState<MappedFieldErrors>(NO_ERRORS);
  const summaryRef = useRef<HTMLDivElement>(null);

  const invalidFields = FORM_FIELDS.filter((field) => (errors.byField[field]?.length ?? 0) > 0);
  const hasErrors = invalidFields.length > 0 || errors.general.length > 0;

  // After a failed submission, move focus to the error summary so it is announced.
  useEffect(() => {
    if (hasErrors) summaryRef.current?.focus();
  }, [errors, hasErrors]);

  const setField = (field: WorkFormField) => (value: string) => setValues((current) => ({ ...current, [field]: value }));

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrors(NO_ERRORS);
    const result = await submit(toCreateWorkRequest(values));
    if (result.ok) onCreated(result.work);
    else setErrors(errorsFromFailure(result.error));
  };

  return (
    <form className={styles.form} onSubmit={handleSubmit} noValidate aria-busy={submitting}>
      {hasErrors && (
        <div ref={summaryRef} className={styles.summary} role="alert" tabIndex={-1} aria-labelledby="form-error-title">
          <p id="form-error-title" className={styles.summaryTitle}>
            {invalidFields.length > 0
              ? `Please correct ${invalidFields.length === 1 ? 'this field' : `these ${invalidFields.length} fields`}:`
              : 'The work could not be added.'}
          </p>
          <ul className={styles.summaryList}>
            {invalidFields.map((field) => (
              <li key={field}>
                <a href={`#${FIELD_IDS[field]}`}>{errors.byField[field]?.[0] ?? FIELD_LABELS[field]}</a>
              </li>
            ))}
            {errors.general.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </div>
      )}

      <TextField
        id={FIELD_IDS.title}
        label={FIELD_LABELS.title}
        value={values.title}
        onChange={setField('title')}
        errors={errors.byField.title ?? []}
        hint="For example: Erlkönig"
        required
      />
      <TextField
        id={FIELD_IDS.composerName}
        label={FIELD_LABELS.composerName}
        value={values.composerName}
        onChange={setField('composerName')}
        errors={errors.byField.composerName ?? []}
        hint="Family name first, for example: Schubert, Franz"
        autoComplete="on"
      />
      <TextField
        id={FIELD_IDS.catalogueNumber}
        label={FIELD_LABELS.catalogueNumber}
        value={values.catalogueNumber}
        onChange={setField('catalogueNumber')}
        errors={errors.byField.catalogueNumber ?? []}
        hint="For example: D.328 or Op. 9"
      />
      <TextField
        id={FIELD_IDS.pageUrl}
        label={FIELD_LABELS.pageUrl}
        value={values.pageUrl}
        onChange={setField('pageUrl')}
        errors={errors.byField.pageUrl ?? []}
        hint="A web page about the work, starting with http:// or https://"
        type="url"
      />

      <div className={styles.actions}>
        <button type="submit" className={controls.primary} disabled={submitting}>
          {submitting ? 'Adding…' : 'Add work'}
        </button>
        <button type="button" className={controls.secondary} onClick={() => { setValues(EMPTY_WORK_FORM); setErrors(NO_ERRORS); }} disabled={submitting}>
          Reset
        </button>
      </div>
      <p className={styles.status} role="status" aria-live="polite">
        {submitting ? 'Adding the work…' : ''}
      </p>
    </form>
  );
}
