import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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
  it("shows single config form by default and hides multi-base add button", () => {
    wrap();
    expect(screen.queryByText(/\+ Add base/i)).not.toBeInTheDocument();
  });

  it("switching to batch mode reveals multi-base add button and hides ConfigForm", async () => {
    const user = userEvent.setup();
    wrap();
    await user.click(screen.getByLabelText(/batch: random sweep/i));
    expect(screen.getByText(/\+ Add base/i)).toBeInTheDocument();
    expect(screen.getByText(/100 random configs/i)).toBeInTheDocument();
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
    const baseInputs = screen.getAllByLabelText(/base \d/i);
    await user.upload(baseInputs[0], new File(["x"], "b1.obs"));

    await user.click(screen.getByRole("button", { name: /submit/i }));
    await waitFor(() => expect(client.createBatch).toHaveBeenCalled());
  });
});
