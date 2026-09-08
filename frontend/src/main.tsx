import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/state/auth";
import { ToastProvider } from "@/components/ui";
import App from "./App";
import "./styles.css";

const qc = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 10_000, refetchOnWindowFocus: true } } });

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <ToastProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </ToastProvider>
      </AuthProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
