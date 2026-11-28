import type { Ref } from 'react';
import controls from '../styles/controls.module.css';
import styles from './TextField.module.css';

interface TextFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  /** Messages from the API's validation errors for this field. */
  errors?: readonly string[];
  required?: boolean;
  type?: 'text' | 'url';
  autoComplete?: string;
  inputRef?: Ref<HTMLInputElement>;
}

/** A labelled text input that shows its validation errors and links them for assistive technology. */
export function TextField({
  id,
  label,
  value,
  onChange,
  hint,
  errors = [],
  required = false,
  type = 'text',
  autoComplete = 'off',
  inputRef,
}: TextFieldProps) {
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const invalid = errors.length > 0;
  const describedBy = [hint ? hintId : null, invalid ? errorId : null].filter(Boolean).join(' ');

  return (
    <div className={styles.field}>
      <label className={controls.label} htmlFor={id}>
        {label}
        {required ? (
          <span className={styles.required}> (required)</span>
        ) : (
          <span className={styles.optional}> (optional)</span>
        )}
      </label>
      {hint && (
        <span id={hintId} className={controls.hint}>
          {hint}
        </span>
      )}
      <input
        id={id}
        ref={inputRef}
        className={controls.input}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={invalid}
        aria-describedby={describedBy || undefined}
        aria-required={required}
        autoComplete={autoComplete}
      />
      {invalid && (
        <ul id={errorId} className={styles.errors}>
          {errors.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
