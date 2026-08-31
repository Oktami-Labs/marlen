import { QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./lib/i18n";
import "./index.css";

import { BrowserRouter } from "react-router-dom";
import { queryClient, startTopicInvalidation } from "./lib/query";

// Server-push freshness for every query, for the app's whole lifetime.
startTopicInvalidation();

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Root element #root not found");

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        {/* Keep router context outside the boundary. Only App and its Toaster are replaced. */}
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
