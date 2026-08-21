import { Link, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, Radar } from "lucide-react";
import { JobsList } from "./pages/JobsList";
import { NewJob } from "./pages/NewJob";
import { JobDetail } from "./pages/JobDetail";
import { BatchDetail } from "./pages/BatchDetail";
import { PageTransition } from "./components/ui/PageTransition";
import { ErrorBoundary } from "./components/ErrorBoundary";

export default function App() {
  const location = useLocation();
  const nav = useNavigate();
  const canGoBack = location.key !== "default";

  console.log("[App] render, pathname=", location.pathname, "key=", location.key);

  return (
    <div className="min-h-screen bg-base text-ink">
      <header className="material-chrome sticky top-0 z-20">
        <div className="mx-auto flex max-w-6xl items-center gap-2 px-6 py-3.5">
          {canGoBack && (
            <button
              type="button"
              aria-label="Back"
              onClick={() => nav(-1)}
              className="flex items-center justify-center rounded-lg p-1.5 text-muted transition-colors duration-150 hover:bg-white/[0.06] hover:text-ink"
            >
              <ArrowLeft size={17} />
            </button>
          )}
          <Link to="/" className="inline-flex items-center gap-2 text-[15px] font-semibold tracking-tight">
            <Radar size={18} className="text-accent" strokeWidth={2.25} />
            GNSS <span className="text-accent">Solver</span>
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">
        <ErrorBoundary>
          <PageTransition>
            <Routes location={location}>
              <Route path="/" element={<JobsList />} />
              <Route path="/new" element={<NewJob />} />
              <Route path="/jobs/:id" element={<JobDetail />} />
              <Route path="/batches/:id" element={<BatchDetail />} />
            </Routes>
          </PageTransition>
        </ErrorBoundary>
      </main>
    </div>
  );
}
