import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth/AuthProvider';
import { Shell } from './components/Shell';
import Login from './pages/Login';
import { PAGE_BY_ID, visiblePages } from './nav';
import { useUi } from './state/ui';

const pages = {
  overview: lazy(() => import('./pages/Overview')),
  devices: lazy(() => import('./pages/Devices')),
  tvexp: lazy(() => import('./pages/TvExperience')),
  ads: lazy(() => import('./pages/Campaigns')),
  customers: lazy(() => import('./pages/Customers')),
  approvals: lazy(() => import('./pages/Approvals')),
  media: lazy(() => import('./pages/MediaPage')),
  screens: lazy(() => import('./pages/Screens')),
  formats: lazy(() => import('./pages/Formats')),
  schedule: lazy(() => import('./pages/Schedule')),
  finance: lazy(() => import('./pages/Finance')),
  integrity: lazy(() => import('./pages/Integrity')),
  history: lazy(() => import('./pages/History')),
  partners: lazy(() => import('./pages/Partners')),
  integrations: lazy(() => import('./pages/Integrations')),
  access: lazy(() => import('./pages/Access')),
  audit: lazy(() => import('./pages/Audit')),
  profile: lazy(() => import('./pages/Profile')),
} as const;

function Splash() {
  const { dark } = useUi();
  return <div className={`tvn ${dark ? 'dark' : ''}`} role="status" style={{ display: 'grid', placeItems: 'center', color: 'var(--mut)' }}>…</div>;
}

function Guard() {
  const { status, can, isExternal } = useAuth();
  const loc = useLocation();
  if (status === 'loading') return <Splash />;
  if (status === 'anon') return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />;
  void can; void isExternal;
  return <Shell />;
}

function Home() {
  const { can, isExternal } = useAuth();
  const first = visiblePages(can, isExternal)[0] ?? 'profile';
  return <Navigate to={PAGE_BY_ID[first]!.path} replace />;
}

function Page({ id }: { id: keyof typeof pages }) {
  const { can, isExternal } = useAuth();
  const allowed = visiblePages(can, isExternal).includes(id) || id === 'profile';
  const P = pages[id];
  if (!allowed) {
    return (
      <div className="card cp" role="alert" style={{ textAlign: 'center', padding: 36 }}>
        <h2 style={{ margin: '0 0 6px' }}>Không có quyền truy cập</h2>
        <p className="sub">Tài khoản của bạn chưa được cấp quyền xem trang này. Liên hệ quản trị viên nếu cần.</p>
      </div>
    );
  }
  return (
    <Suspense fallback={<div className="card cp" role="status" style={{ textAlign: 'center', color: 'var(--mut)', padding: 36 }}>…</div>}>
      <P />
    </Suspense>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<Guard />}>
        <Route index element={<Home />} />
        {(Object.keys(pages) as (keyof typeof pages)[]).map((id) => (
          <Route key={id} path={`${PAGE_BY_ID[id]!.path}/*`} element={<Page id={id} />} />
        ))}
        <Route path="*" element={<Home />} />
      </Route>
    </Routes>
  );
}
