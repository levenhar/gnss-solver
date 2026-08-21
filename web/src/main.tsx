import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import "leaflet/dist/leaflet.css";
import "./index.css";

window.addEventListener("error", (e) => console.error("[window error]", e.error ?? e.message));
window.addEventListener("unhandledrejection", (e) => console.error("[unhandled rejection]", e.reason));

const queryClient = new QueryClient();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>
);
