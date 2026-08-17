import { Link, Route, Routes } from "react-router-dom";
import { JobsList } from "./pages/JobsList";
import { NewJob } from "./pages/NewJob";
import { JobDetail } from "./pages/JobDetail";
import { BatchDetail } from "./pages/BatchDetail";

export default function App() {
  return (
    <div className="min-h-screen bg-base text-ink">
      <header className="border-b border-hair px-6 py-3">
        <Link to="/" className="text-lg font-semibold tracking-tight">
          GNSS <span className="text-accent">Solver</span>
        </Link>
      </header>
      <main className="p-6">
        <Routes>
          <Route path="/" element={<JobsList />} />
          <Route path="/new" element={<NewJob />} />
          <Route path="/jobs/:id" element={<JobDetail />} />
          <Route path="/batches/:id" element={<BatchDetail />} />
        </Routes>
      </main>
    </div>
  );
}
