// Submits a new work. Re-sending the same values reuses the same Idempotency-Key,
// so a retry after a network failure cannot create a duplicate (openapi.yaml).
import { useCallback, useRef, useState } from 'react';
import { useCatalogApi } from '../../../app/ApiContext';
import type { CreateWorkRequest, Work } from '../../../api/types';

export type CreateWorkResult = { ok: true; work: Work } | { ok: false; error: unknown };

export function useCreateWork() {
  const api = useCatalogApi();
  const [submitting, setSubmitting] = useState(false);
  const attempt = useRef<{ body: string; key: string } | null>(null);

  const submit = useCallback(
    async (request: CreateWorkRequest): Promise<CreateWorkResult> => {
      const body = JSON.stringify(request);
      if (attempt.current?.body !== body) attempt.current = { body, key: crypto.randomUUID() };
      setSubmitting(true);
      try {
        const work = await api.createWork(request, { idempotencyKey: attempt.current.key });
        attempt.current = null;
        return { ok: true, work };
      } catch (error) {
        return { ok: false, error };
      } finally {
        setSubmitting(false);
      }
    },
    [api],
  );

  return { submit, submitting };
}
