import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusBadge } from "./StatusBadge";

describe("StatusBadge", () => {
  it("renders each status label", () => {
    for (const s of ["queued", "started", "finished", "failed"]) {
      const { unmount } = render(<StatusBadge status={s} />);
      expect(screen.getByText(new RegExp(s, "i"))).toBeInTheDocument();
      unmount();
    }
  });
});
