import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

  it("shows the name instead of the id when the job has one", async () => {
    vi.spyOn(client, "listJobs").mockResolvedValue([{ job_id: "abc123", status: "finished", name: "My Survey" }]);
    vi.spyOn(client, "listBatches").mockResolvedValue([]);
    wrap(<JobsList />);
    await waitFor(() => expect(screen.getByText("My Survey")).toBeInTheDocument());
    expect(screen.queryByText("abc123")).not.toBeInTheDocument();
  });

  it("deletes a job after confirming, then refreshes the list", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.spyOn(client, "listBatches").mockResolvedValue([]);
    vi.spyOn(client, "listJobs")
      .mockResolvedValueOnce([{ job_id: "abc123", status: "finished" }])
      .mockResolvedValueOnce([]);
    vi.spyOn(client, "deleteJob").mockResolvedValue();
    wrap(<JobsList />);
    await waitFor(() => expect(screen.getByText(/abc123/)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /delete/i }));
    await waitFor(() => expect(client.deleteJob).toHaveBeenCalledWith("abc123"));
    await waitFor(() => expect(screen.queryByText(/abc123/)).not.toBeInTheDocument());
  });

  it("does not delete when the confirm dialog is cancelled", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(false);
    vi.spyOn(client, "listBatches").mockResolvedValue([]);
    vi.spyOn(client, "listJobs").mockResolvedValue([{ job_id: "abc123", status: "finished" }]);
    const del = vi.spyOn(client, "deleteJob");
    wrap(<JobsList />);
    await waitFor(() => expect(screen.getByText(/abc123/)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /delete/i }));
    expect(del).not.toHaveBeenCalled();
  });
});
