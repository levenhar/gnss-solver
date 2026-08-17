import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { JobsList } from "./JobsList";
import { client } from "../api/client";

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe("JobsList", () => {
  it("lists jobs from the API", async () => {
    vi.spyOn(client, "listJobs").mockResolvedValue([{ job_id: "abc123", status: "finished" }]);
    wrap(<JobsList />);
    await waitFor(() => expect(screen.getByText(/abc123/)).toBeInTheDocument());
  });

  it("lists batches alongside jobs with progress", async () => {
    vi.spyOn(client, "listJobs").mockResolvedValue([{ job_id: "abc123", status: "finished" }]);
    vi.spyOn(client, "listBatches").mockResolvedValue([{ batch_id: "batch1", status: "running", done: 40, total: 100 }]);
    wrap(<JobsList />);
    await waitFor(() => expect(screen.getByText(/batch1/)).toBeInTheDocument());
    expect(screen.getByText(/40\s*\/\s*100/)).toBeInTheDocument();
  });

  it("shows accurate error message when only listBatches fails", async () => {
    vi.spyOn(client, "listJobs").mockResolvedValue([{ job_id: "abc123", status: "finished" }]);
    vi.spyOn(client, "listBatches").mockRejectedValue(new Error("Batches API failed"));
    wrap(<JobsList />);
    await waitFor(() => expect(screen.getByText(/abc123/)).toBeInTheDocument());
    expect(screen.getByText("Failed to load batches.")).toBeInTheDocument();
    expect(screen.queryByText("Failed to load jobs.")).not.toBeInTheDocument();
  });

  it("shows accurate error message when only listJobs fails", async () => {
    vi.spyOn(client, "listJobs").mockRejectedValue(new Error("Jobs API failed"));
    vi.spyOn(client, "listBatches").mockResolvedValue([{ batch_id: "batch1", status: "running", done: 1, total: 5 }]);
    wrap(<JobsList />);
    await waitFor(() => expect(screen.getByText(/batch1/)).toBeInTheDocument());
    expect(screen.getByText("Failed to load jobs.")).toBeInTheDocument();
    expect(screen.queryByText("Failed to load batches.")).not.toBeInTheDocument();
  });

  it("shows combined error message when both listJobs and listBatches fail", async () => {
    vi.spyOn(client, "listJobs").mockRejectedValue(new Error("Jobs API failed"));
    vi.spyOn(client, "listBatches").mockRejectedValue(new Error("Batches API failed"));
    wrap(<JobsList />);
    await waitFor(() => expect(screen.getByText("Failed to load jobs and batches.")).toBeInTheDocument());
  });
});
