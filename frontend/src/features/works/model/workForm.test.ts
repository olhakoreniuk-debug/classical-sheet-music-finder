import { describe, expect, it } from 'vitest';
import { mapFieldErrors, toCreateWorkRequest } from './workForm';

describe('work form model', () => {
  it('sends empty optional fields as null and the title as typed', () => {
    expect(toCreateWorkRequest({ title: '  ', composerName: '', catalogueNumber: ' ', pageUrl: 'https://x.example' })).toEqual({
      title: '  ',
      composerName: null,
      catalogueNumber: null,
      pageUrl: 'https://x.example',
    });
  });

  it('assigns body field errors to form fields and keeps the rest as general errors', () => {
    const mapped = mapFieldErrors([
      { location: 'body', field: '/title', code: 'blank', message: 'Title must not be blank.' },
      { location: 'body', field: '/pageUrl', code: 'invalid_format', message: 'Bad URL.' },
      { location: 'header', field: 'Idempotency-Key', code: 'idempotency_key_reused', message: 'Use a new key.' },
    ]);
    expect(mapped.byField).toEqual({ title: ['Title must not be blank.'], pageUrl: ['Bad URL.'] });
    expect(mapped.general).toEqual(['Use a new key.']);
  });
});
