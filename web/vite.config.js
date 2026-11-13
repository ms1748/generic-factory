// The dashboard page: Svelte compiled to a few static files in web/dist, served by the dispatcher.
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";
import { fixture } from "./dev/mock.js";

export default defineConfig(({ mode }) => {
  // `npm run dev:fixture` serves a saved /api/state (web/dev/state.json, see dev/mock.js); FACTORY_FIXTURE
  // names another file. Plain `npm run dev:web` talks to a running dispatcher (FACTORY_PORT, default 8080).
  const saved = process.env.FACTORY_FIXTURE ?? (mode === "fixture" ? `${import.meta.dirname}/dev/state.json` : undefined);
  return {
    root: import.meta.dirname,
    plugins: [svelte(), ...(saved ? [fixture(saved)] : [])],
    build: { outDir: "dist", emptyOutDir: true, assetsInlineLimit: 0 },
    server: saved ? {} : { proxy: { "/api": `http://localhost:${process.env.FACTORY_PORT ?? 8080}` } },
  };
});
