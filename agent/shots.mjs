// Before/after screenshots for a website PR (src/shots.ts). No model and no GitHub token: Chromium opens
// each page on production (before) and on the PR's preview (after) at each width, and prints one JSON line
// per shot on stdout: { page, device, side, png (base64) } or { ..., error }. The Access service token goes
// only to those two hosts, never to anything else a page loads.
import { chromium } from "playwright";

const spec = JSON.parse(process.env.FACTORY_SHOTS ?? "{}");
const bases = { before: spec.before, after: spec.after };
const hosts = new Set(Object.values(bases).map((b) => new URL(b).hostname));
const access = process.env.CF_ACCESS_CLIENT_ID
  ? { "cf-access-client-id": process.env.CF_ACCESS_CLIENT_ID, "cf-access-client-secret": process.env.CF_ACCESS_CLIENT_SECRET ?? "" }
  : {};
const out = (line) => process.stdout.write(JSON.stringify(line) + "\n");

const browser = await chromium.launch({ args: ["--disable-dev-shm-usage"] });
try {
  for (const d of spec.devices ?? []) {
    const ctx = await browser.newContext({ viewport: { width: d.width, height: d.height }, isMobile: d.mobile, hasTouch: d.mobile, deviceScaleFactor: 1 });
    await ctx.route("**/*", (route) => {
      const req = route.request();
      const own = hosts.has(new URL(req.url()).hostname);
      return route.continue(own ? { headers: { ...req.headers(), ...access } } : undefined);
    });
    for (const page of spec.pages ?? []) {
      for (const side of ["before", "after"]) {
        const shot = { page, device: d.name, side };
        const p = await ctx.newPage();
        try {
          const res = await p.goto(bases[side] + page, { waitUntil: "load", timeout: 20_000 });
          if (!res || res.status() >= 400) throw new Error(`HTTP ${res?.status() ?? "no response"}`);
          await p.waitForLoadState("networkidle", { timeout: 3_000 }).catch(() => {});
          // The page from the top, at most two screens tall.
          const tall = await p.evaluate(() => document.documentElement.scrollHeight);
          const png = await p.screenshot({ type: "png", fullPage: true, clip: { x: 0, y: 0, width: d.width, height: Math.min(tall, d.height * 2) } });
          out({ ...shot, png: png.toString("base64") });
        } catch (e) {
          out({ ...shot, error: String(e.message ?? e).split("\n")[0].slice(0, 200) });
        } finally {
          await p.close();
        }
      }
    }
    await ctx.close();
  }
} finally {
  await browser.close();
}
