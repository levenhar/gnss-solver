import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { NewJob } from "./NewJob";
import { client } from "../api/client";

function wrap() {
  return render(
    <MemoryRouter>
      <NewJob />
    </MemoryRouter>
  );
}

describe("NewJob batch mode", () => {
  beforeEach(() => {
    // Time-sync auto-check fires whenever rover+nav files are present; keep it
    // resolved "ok" here so tests unrelated to time-sync aren't gated on a
    // real network call. Dedicated time-sync tests override this per-case.
    vi.spyOn(client, "checkTimeSync").mockResolvedValue({ ok: true, rover: null, bases: [], nav: null, issues: [] });
  });

  it("shows single config form by default and hides multi-base add button", () => {
    wrap();
    expect(screen.queryByText(/\+ Add base/i)).not.toBeInTheDocument();
  });

  it("switching to batch mode reveals multi-base add button and sweep config form", async () => {
    const user = userEvent.setup();
    wrap();
    await user.click(screen.getByLabelText(/batch: random sweep/i));
    expect(screen.getByText(/\+ Add base/i)).toBeInTheDocument();
    expect(screen.getByText(/positioning mode \(fixed for whole batch\)/i)).toBeInTheDocument();
  });

  it("submits batch via client.createBatch when in batch mode", async () => {
    const user = userEvent.setup();
    vi.spyOn(client, "createBatch").mockResolvedValue({ batch_id: "b1", status: "queued", n_bases: 1, n_configs: 100 });
    wrap();
    await user.click(screen.getByLabelText(/batch: random sweep/i));

    const roverInput = screen.getByLabelText(/rover/i) as HTMLInputElement;
    await user.upload(roverInput, new File(["x"], "r.rnx"));
    const navInput = screen.getByLabelText(/navigation/i) as HTMLInputElement;
    await user.upload(navInput, new File(["x"], "a.nav"));
    const baseInputs = screen.getAllByLabelText(/^base \d+$/i);
    await user.upload(baseInputs[0], new File(["x"], "b1.obs"));

    // Submit stays disabled until the debounced time-sync check (mocked "ok" above) resolves.
    const submitButton = screen.getByRole("button", { name: /submit/i });
    await waitFor(() => expect(submitButton).not.toBeDisabled());
    await user.click(submitButton);
    await waitFor(() => expect(client.createBatch).toHaveBeenCalled());
  });

  it("passes the name field through to createJob", async () => {
    const user = userEvent.setup();
    vi.spyOn(client, "createJob").mockResolvedValue({ job_id: "j1", status: "queued" });
    wrap();

    await user.type(screen.getByLabelText(/^name/i), "My Survey");
    const roverInput = screen.getByLabelText(/rover/i) as HTMLInputElement;
    await user.upload(roverInput, new File(["x"], "r.rnx"));
    const navInput = screen.getByLabelText(/navigation/i) as HTMLInputElement;
    await user.upload(navInput, new File(["x"], "a.nav"));

    // jsdom doesn't clear the `required` file input's validity even once a file is
    // attached, so a native click-triggered submit (userEvent v14) is blocked by
    // constraint validation that a real browser would pass. Submit the form
    // directly to exercise the same onSubmit handler without that jsdom limitation.
    fireEvent.submit(screen.getByRole("button", { name: /submit/i }).closest("form")!);
    await waitFor(() => expect(client.createJob).toHaveBeenCalled());
    const fd = (client.createJob as any).mock.calls[0][0] as FormData;
    expect(fd.get("name")).toBe("My Survey");
  });

  it("removing a base row deletes that row, not just its value", async () => {
    const user = userEvent.setup();
    wrap();
    await user.click(screen.getByLabelText(/batch: random sweep/i));

    // Batch mode starts with 1 base slot; add a second so there are 2 rows.
    await user.click(screen.getByText(/\+ Add base/i));
    expect(screen.getAllByLabelText(/^base \d+$/i)).toHaveLength(2);

    const baseInputsBefore = screen.getAllByLabelText(/^base \d+$/i) as HTMLInputElement[];
    await user.upload(baseInputsBefore[0], new File(["x"], "first.obs"));
    await user.upload(baseInputsBefore[1], new File(["x"], "second.obs"));

    const removeButtons = screen.getAllByRole("button", { name: /remove/i });
    await user.click(removeButtons[0]);

    const baseInputsAfter = screen.getAllByLabelText(/^base \d+$/i) as HTMLInputElement[];
    expect(baseInputsAfter).toHaveLength(1);
    expect(baseInputsAfter[0]).toHaveAccessibleName(/base 1/i);
    // The remaining row should carry forward the second file, not the first.
    expect(baseInputsAfter[0].files?.[0]?.name).toBe("second.obs");
  });

  it("blocks submit and shows issues when the time-sync check reports a mismatch", async () => {
    vi.spyOn(client, "checkTimeSync").mockResolvedValue({
      ok: false,
      rover: null,
      bases: [],
      nav: null,
      issues: ["Rover and base 'b.obs' do not overlap in time."],
    });
    const user = userEvent.setup();
    wrap();

    const roverInput = screen.getByLabelText(/rover/i) as HTMLInputElement;
    await user.upload(roverInput, new File(["x"], "r.rnx"));
    const navInput = screen.getByLabelText(/navigation/i) as HTMLInputElement;
    await user.upload(navInput, new File(["x"], "a.nav"));

    await waitFor(() => expect(screen.getByText(/do not overlap in time/i)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /submit/i })).toBeDisabled();
  });
});
