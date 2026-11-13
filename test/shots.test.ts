import assert from "node:assert/strict";
import { test } from "node:test";
import { assetName, DEVICES, MAX_PAGES, previewAlias, shotPages, shotsComment, shotSpec, touchesUi } from "../src/shots.ts";
import type { Shot } from "../src/shots.ts";
import { parseVerdict } from "../src/review.ts";
import { State } from "../src/state.ts";

test("only website and UI files count", () => {
  assert.equal(touchesUi(["website/index.html"]), true);
  assert.equal(touchesUi(["website/assets/logo.svg"]), true);
  assert.equal(touchesUi(["src/App.svelte", "README.md"]), true);
  assert.equal(touchesUi(["src/styles/main.css"]), true);
  assert.equal(touchesUi(["src/queue.ts", "native/src/main.rs", "docs/site.html", "web/src/App.svelte"]), false);
  assert.equal(touchesUi([]), false);
});

test("the preview alias is Cloudflare's: lower case, dashes, 28 characters", () => {
  assert.equal(previewAlias("claude/issue-131-demo-no-keys"), "claude-issue-131-demo-no-key");
  assert.equal(previewAlias("Feat/New_Page"), "feat-new-page");
});

test("pages: the reviewer's plain paths, deduped and capped; else the home page", () => {
  assert.deepEqual(shotPages(["/download", " /download ", "/blog/post-1"]), ["/download", "/blog/post-1"]);
  assert.deepEqual(shotPages(["/a", "/b", "/c", "/d"]).length, MAX_PAGES);
  assert.deepEqual(shotPages([]), ["/"]);
  // No other hosts, queries, schemes or climbing out.
  assert.deepEqual(shotPages(["https://evil.example/x", "//evil.example", "/x?y=1", "/../etc", "download", "/a b"]), ["/"]);
});

test("the spec: production before, the branch's preview after; none without a preview host", () => {
  const s = shotSpec("claude/issue-9-hero", ["/"], "site.example.dev")!;
  assert.equal(s.before, "https://site.example.dev");
  assert.equal(s.after, "https://claude-issue-9-hero.site.example.dev");
  assert.deepEqual(s.devices.map((d) => d.name), ["desktop", "phone"]);
  assert.equal(shotSpec("claude/issue-9-hero", ["/"], ""), undefined);
});

test("asset names are readable and unique per run", () => {
  assert.equal(assetName(12, 345, { page: "/", device: "phone", side: "before" }), "pr12-run345-home-phone-before.png");
  assert.equal(assetName(12, 345, { page: "/blog/post-1/", device: "desktop", side: "after" }), "pr12-run345-blog-post-1-desktop-after.png");
});

test("the comment: a before/after table per page, errors in place of missing images", () => {
  const spec = shotSpec("claude/issue-9-hero", ["/", "/download"], "site.example.dev")!;
  const shots: Shot[] = [];
  for (const page of spec.pages) for (const d of DEVICES) for (const side of ["before", "after"] as const) shots.push({ page, device: d.name, side, png: "AA==" });
  shots[0] = { page: "/", device: "desktop", side: "before", error: "HTTP 404" };
  const urls = new Map(shots.filter((s) => s.png).map((s) => [s, `https://github.com/o/r/releases/download/factory-screenshots/${assetName(1, 2, s)}`]));
  const c = shotsComment(spec, shots, urls, 21.4);
  assert.match(c, /^🤖 \*\*Factory:\*\* Before and after/);
  assert.match(c, /\*\*`\/download`\*\*/);
  assert.match(c, /\| Desktop \| _no image: HTTP 404_ \| <a href="([^"]+pr1-run2-home-desktop-after\.png)"><img src="\1" width="400" alt="after, desktop"><\/a> \|/);
  assert.match(c, /\| Phone \| <a href="[^"]+home-phone-before\.png"><img src="[^"]+home-phone-before\.png" width="200"/);
  assert.match(c, /taken in 21 s/);
  assert.ok(c.endsWith("<!-- factory -->"));
});

test("the verdict carries the reviewer's pages", () => {
  const v = parseVerdict('ok\n\n```json\n{"verdict":"ready","must_fix":[],"pages":["/","/download"]}\n```');
  assert.deepEqual(v?.pages, ["/", "/download"]);
  assert.deepEqual(parseVerdict('ok\n\n```json\n{"verdict":"ready"}\n```')?.pages, []);
});

test("the switch is off until the owner turns it on", () => {
  const s = new State(":memory:");
  assert.equal(s.shotsOn(), false);
  s.setShotsOn(true);
  assert.equal(s.shotsOn(), true);
});
