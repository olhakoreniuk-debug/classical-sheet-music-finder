// Generic loader for read operations: loading / success / error states,
// cancellation of outdated requests and a retry function. Used by every
// data hook, so this logic exists once (DRY).
import { useCallback, useEffect, useRef, useState } from 'react';
import { isAbortError } from '../api/apiError';

export type ResourceState<T> =
  | { status: 'loading'; previous: T | null }
  | { status: 'success'; data: T }
  | { status: 'error'; error: unknown };

export interface AsyncResource<T> {
  state: ResourceState<T>;
  reload: () => void;
}

/**
 * @param key  changes whenever the request changes (e.g. serialised query)
 * @param load performs the request; receives an AbortSignal
 */
export function useAsyncResource<T>(key: string, load: (signal: AbortSignal) => Promise<T>): AsyncResource<T> {
  const [state, setState] = useState<ResourceState<T>>({ status: 'loading', previous: null });
  const [attempt, setAttempt] = useState(0);
  const loadRef = useRef(load);

  useEffect(() => {
    loadRef.current = load;
  });

  useEffect(() => {
    const controller = new AbortController();
    setState((current) => ({
      status: 'loading',
      previous: current.status === 'success' ? current.data : current.status === 'loading' ? current.previous : null,
    }));
    loadRef.current(controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) setState({ status: 'success', data });
      },
      (error: unknown) => {
        if (!controller.signal.aborted && !isAbortError(error)) setState({ status: 'error', error });
      },
    );
    return () => controller.abort();
  }, [key, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return { state, reload };
}
