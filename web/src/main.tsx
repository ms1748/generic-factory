import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// Geist, served from the dashboard itself (the page's CSP allows no other origin).
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./app.css";
import "./lib/theme";
import { App } from "./App";

// With the built-in sign-in (src/auth.ts): every control POST echoes the session's CSRF token, and an expired
// session sends the page back to /login. Behind Cloudflare Access there's no factory_csrf cookie and no 401.
const realFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
  const method = (init.method ?? "GET").toUpperCase();
  const csrf = document.cookie
    .split("; ")
    .find((c) => c.startsWith("factory_csrf="))
    ?.slice("factory_csrf=".length);
  if (csrf && method !== "GET" && method !== "HEAD") {
    const headers = new Headers(init.headers);
    headers.set("x-factory-csrf", decodeURIComponent(csrf));
    init = { ...init, headers };
  }
  const res = await realFetch(input, init);
  if (res.status === 401 && String(input).startsWith("/api/")) location.assign("/login");
  return res;
};

createRoot(document.getElementById("app")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// The offline shell (web/public/sw.js), which also makes the dashboard installable on a phone. Not in dev,
// where it would keep serving old code.
if (import.meta.env.PROD && "serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
