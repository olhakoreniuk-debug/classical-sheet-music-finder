import { Route, Routes } from 'react-router';
import { NotFoundPage } from '../components/NotFoundPage';
import { DashboardPage } from '../features/dashboard/components/DashboardPage';
import { NewWorkPage } from '../features/works/components/NewWorkPage';
import { WorkCataloguePage } from '../features/works/components/WorkCataloguePage';
import { WorkDetailPage } from '../features/works/components/WorkDetailPage';
import { Layout } from './Layout';

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<DashboardPage />} />
        <Route path="works" element={<WorkCataloguePage />} />
        <Route path="works/new" element={<NewWorkPage />} />
        <Route path="works/:workId" element={<WorkDetailPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
