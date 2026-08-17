import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Solution } from "../api/types";

// Mock react-leaflet with simple divs so jsdom can render without a real map.
vi.mock("react-leaflet", () => ({
  MapContainer: ({ children }: any) => <div data-testid="map">{children}</div>,
  TileLayer: () => <div data-testid="tile" />,
  CircleMarker: ({ children }: any) => <div data-testid="marker">{children}</div>,
  Polygon: () => <div data-testid="ellipse" />,
  Popup: ({ children }: any) => <div>{children}</div>,
  LayersControl: Object.assign(({ children }: any) => <div>{children}</div>, { BaseLayer: ({ children }: any) => <div>{children}</div> }),
  Tooltip: ({ children }: any) => <div>{children}</div>,
}));

import { TrackMap } from "./TrackMap";

const sol = {
  meta: { rover_id: "R" },
  epochs: [
    { t: "2023-01-01T00:00:00Z", lat: 32, lon: 34, h: 50, q: 1, ns: 9, sdn: 0.004, sde: 0.005, sdu: 0.009, sdne: 0.001, age: 0, ratio: 99, x: null, y: null, z: null },
    { t: "2023-01-01T00:00:01Z", lat: 32.0001, lon: 34.0001, h: 51, q: 2, ns: 8, sdn: 0.02, sde: 0.02, sdu: 0.04, sdne: 0, age: 0, ratio: 2, x: null, y: null, z: null },
  ],
  sat_stats: [],
  summary: {} as any,
  config_used: { mode: "static" },
} as unknown as Solution;

describe("TrackMap", () => {
  it("renders a marker per epoch", () => {
    render(<TrackMap solution={sol} />);
    expect(screen.getByTestId("map")).toBeInTheDocument();
    expect(screen.getAllByTestId("marker").length).toBe(2);
  });
});
