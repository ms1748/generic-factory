import { mount } from "svelte";
import App from "./App.svelte";
// IBM Plex, served from the dashboard itself (the page's CSP allows no other origin).
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./app.css";

// With the built-in sign-in (src/auth.ts): every control POST echoes the session's CSRF token, and an expired
// session sends the page back to /login. Behind Cloudflare Access there's no factory_csrf cookie and no 401.
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init = {}) => {
  const method = (init.method ?? "GET").toUpperCase();
  const csrf = document.cookie.split("; ").find((c) => c.startsWith("factory_csrf="))?.slice("factory_csrf=".length);
  if (csrf && method !== "GET" && method !== "HEAD") {
    const headers = new Headers(init.headers);
    headers.set("x-factory-csrf", decodeURIComponent(csrf));
    init = { ...init, headers };
  }
  const res = await realFetch(input, init);
  if (res.status === 401 && String(input).startsWith("/api/")) location.assign("/login");
  return res;
};

mount(App,{ target: document.getElementById("app") });
