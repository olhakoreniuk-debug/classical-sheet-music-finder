import { Link } from 'react-router';
import { paths } from '../app/paths';
import { EmptyState } from './EmptyState';

export function NotFoundPage() {
  return (
    <>
      <h1>Page not found</h1>
      <EmptyState
        title="There is nothing at this address."
        message="The link may be mistyped or out of date."
        action={<Link to={paths.catalogue}>Go to the catalogue</Link>}
      />
    </>
  );
}
