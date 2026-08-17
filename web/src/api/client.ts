import type { BatchCreated, BatchListItem, BatchReport, BatchStatus, JobCreated, JobListItem, JobStatus, Solution } from "./types";

export function apiBase(): string {
  return (import.meta.env.VITE_API_BASE as string | undefined) ?? "http://localhost:8000";
}

export class ApiError extends Error {
  status: number;
  detail: unknown;
  constructor(status: number, detail: unknown) {
    super(typeof detail === "string" ? detail : `request failed (${status})`);
    this.status = status;
    this.detail = detail;
  }
}

async function parse<T>(res: Response): Promise<T> {
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, body?.detail ?? body);
  return body as T;
}

export const client = {
  async listJobs(): Promise<JobListItem[]> {
    return parse(await fetch(`${apiBase()}/jobs`));
  },
  async getJob(id: string): Promise<JobStatus> {
    return parse(await fetch(`${apiBase()}/jobs/${id}`));
  },
  async getResult(id: string): Promise<Solution> {
    return parse(await fetch(`${apiBase()}/jobs/${id}/result`));
  },
  async createJob(form: FormData): Promise<JobCreated> {
    return parse(await fetch(`${apiBase()}/jobs`, { method: "POST", body: form }));
  },
  async createBatch(form: FormData): Promise<BatchCreated> {
    return parse(await fetch(`${apiBase()}/batches`, { method: "POST", body: form }));
  },
  async listBatches(): Promise<BatchListItem[]> {
    return parse(await fetch(`${apiBase()}/batches`));
  },
  async getBatch(id: string): Promise<BatchStatus> {
    return parse(await fetch(`${apiBase()}/batches/${id}`));
  },
  async getBatchReport(id: string): Promise<BatchReport> {
    return parse(await fetch(`${apiBase()}/batches/${id}/report`));
  },
  async health(): Promise<{ status: string; redis: boolean }> {
    return parse(await fetch(`${apiBase()}/health`));
  },
};
