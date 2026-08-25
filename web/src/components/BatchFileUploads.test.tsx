import { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BatchFileUploads } from "./BatchFileUploads";
import type { BatchFiles } from "../lib/buildBatchForm";

function baseFiles(overrides: Partial<BatchFiles> = {}): BatchFiles {
  return {
    rover: null,
    nav: [],
    bases: [{ file: null, base_coord_mode: "single", base_coord: null }],
    ...overrides,
  };
}

function Harness({ initial }: { initial: BatchFiles }) {
  const [value, setValue] = useState(initial);
  return <BatchFileUploads value={value} onChange={setValue} />;
}

describe("BatchFileUploads", () => {
  it("defaults each base row to single mode with no coordinate inputs", () => {
    render(<BatchFileUploads value={baseFiles()} onChange={() => {}} />);
    expect(screen.getByLabelText("Base 1 coordinate mode")).toHaveValue("single");
    expect(screen.queryByLabelText("Base 1 coordinate 0")).not.toBeInTheDocument();
  });

  it("shows 3 coordinate inputs defaulted to 0 when mode switches off single", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<BatchFileUploads value={baseFiles()} onChange={onChange} />);
    await user.selectOptions(screen.getByLabelText("Base 1 coordinate mode"), "known-llh");
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        bases: [expect.objectContaining({ base_coord_mode: "known-llh", base_coord: [0, 0, 0] })],
      })
    );
  });

  it("clears the coordinate back to null when mode switches back to single", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const value = baseFiles({ bases: [{ file: null, base_coord_mode: "known-llh", base_coord: [1, 2, 3] }] });
    render(<BatchFileUploads value={value} onChange={onChange} />);
    await user.selectOptions(screen.getByLabelText("Base 1 coordinate mode"), "single");
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        bases: [expect.objectContaining({ base_coord_mode: "single", base_coord: null })],
      })
    );
  });

  it("updates a single coordinate axis without touching the others", async () => {
    const user = userEvent.setup();
    render(
      <Harness
        initial={baseFiles({ bases: [{ file: null, base_coord_mode: "known-xyz", base_coord: [1, 2, 3] }] })}
      />
    );
    const input = screen.getByLabelText("Base 1 coordinate 1");
    await user.clear(input);
    await user.type(input, "9");
    expect(screen.getByLabelText("Base 1 coordinate 0")).toHaveValue(1);
    expect(input).toHaveValue(9);
    expect(screen.getByLabelText("Base 1 coordinate 2")).toHaveValue(3);
  });
});
