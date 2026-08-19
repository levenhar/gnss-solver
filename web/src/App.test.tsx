import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

vi.mock("react-plotly.js", () => ({ default: () => <div data-testid="plot" /> }));

import App from "./App";

function wrap(initialEntries: string[], initialIndex = 0) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={initialEntries} initialIndex={initialIndex}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("App back button", () => {
  it("hides the back button on the initial history entry", () => {
    wrap(["/"]);
    expect(screen.queryByRole("button", { name: /back/i })).not.toBeInTheDocument();
  });

  it("shows the back button after navigating away from the initial entry", () => {
    wrap(["/", "/new"], 1);
    expect(screen.getByRole("button", { name: /back/i })).toBeInTheDocument();
  });
});
