// The dashboard page: React + Tailwind compiled to a few static files in web/dist, served by the dispatcher.
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { fixture } from "./dev/mock.js";

export default defineConfig(({ mode }) => {
  // `npm run dev:fixture` serves a saved /api/state (web/dev/state.json, see dev/mock.js); FACTORY_FIXTURE
  // names another file. Plain `npm run dev:web` talks to a running dispatcher (FACTORY_PORT, default 8080).
  const saved = process.env.FACTORY_FIXTURE ?? (mode === "fixture" ? `${import.meta.dirname}/dev/state.json` : undefined);
  return {
    root: import.meta.dirname,
    resolve: { alias: { "@": `${import.meta.dirname}/src` } },
    plugins: [react(), tailwindcss(), ...(saved ? [fixture(saved)] : [])],
    build: { outDir: "dist", emptyOutDir: true, assetsInlineLimit: 0, chunkSizeWarningLimit: 1200 },
    server: saved ? {} : { proxy: { "/api": `http://localhost:${process.env.FACTORY_PORT ?? 8080}` } },
  };
});
