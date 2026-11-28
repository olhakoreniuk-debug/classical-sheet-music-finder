// Detail page: reads the id from the URL, loads the work and chooses the state to show.
import type { ReactNode } from 'react';
import { Link, useLocation, useParams } from 'react-router';
import { isApiError } from '../../../api/apiError';
import { paths } from '../../../app/paths';
import { EmptyState } from '../../../components/EmptyState';
import { ErrorState } from '../../../components/ErrorState';
import { LoadingState } from '../../../components/LoadingState';
import { useWork } from '../hooks/useWork';
import { RelatedWorks } from './RelatedWorks';
import { WorkDetail } from './WorkDetail';
import styles from './WorkDetailPage.module.css';

interface DetailLocationState {
  from?: string;
  created?: boolean;
}

function parseWorkId(raw: string | undefined): number | null {
  if (!raw || !/^\d+$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) && id >= 1 ? id : null;
}

export function WorkDetailPage() {
  const { workId: rawId } = useParams();
  const workId = parseWorkId(rawId);
  const state = (useLocation().state ?? {}) as DetailLocationState;
  const backTo = `${paths.catalogue}${state.from ?? ''}`;

  const backLink = (
    <Link to={backTo} className={styles.back}>
      <span aria-hidden="true">←</span> Back to the catalogue
    </Link>
  );

  if (workId === null) {
    return (
      <>
        {backLink}
        <h1>Work not found</h1>
        <EmptyState title="This is not a valid work address." message="Work identifiers are positive whole numbers." />
      </>
    );
  }
  return <WorkDetailContent workId={workId} backLink={backLink} justCreated={state.created === true} />;
}

interface ContentProps {
  workId: number;
  backLink: ReactNode;
  justCreated: boolean;
}

function WorkDetailContent({ workId, backLink, justCreated }: ContentProps) {
  const { state, reload } = useWork(workId);

  if (state.status === 'loading') {
    return (
      <>
        {backLink}
        <LoadingState label="Loading the work…" />
      </>
    );
  }

  if (state.status === 'error') {
    const notFound = isApiError(state.error) && state.error.status === 404;
    return (
      <>
        {backLink}
        <h1>{notFound ? 'Work not found' : 'The work could not be loaded'}</h1>
        {notFound ? (
          <EmptyState
            title={`There is no work with id ${workId}.`}
            message="It may have been removed, or the link may be wrong."
            action={<Link to={paths.catalogue}>Browse the catalogue</Link>}
          />
        ) : (
          <ErrorState title="Something went wrong." error={state.error} onRetry={reload} />
        )}
      </>
    );
  }

  return (
    <>
      {backLink}
      {justCreated && (
        <p className={styles.success} role="status">
          <span aria-hidden="true">✓</span> The work was added to the catalogue.
        </p>
      )}
      <WorkDetail work={state.data} />
      <RelatedWorks work={state.data} />
    </>
  );
}
