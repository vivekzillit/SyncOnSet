import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider, createBrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/state/auth";
import { ToastProvider } from "@/components/ui";
import App from "./App";
import "./styles.css";

// A data router (rather than <BrowserRouter>) so pages with unsaved changes can hold a navigation back and ask first.
// App keeps its own <Routes>; this single catch-all route just hosts it.
const router = createBrowserRouter([{ path: "*", element: <App /> }]);

const qc = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 10_000, refetchOnWindowFocus: true } } });

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </AuthProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
