import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { MARKER } from "../src/activity.ts";
import { defaults, fromYaml } from "../src/config.ts";
import { LABELS, missingLabels } from "../src/labels.ts";
import { blockersIn, EXCLUDED, isAgent, issueOfPull, PRIORITIES } from "../src/queue.ts";
import { initProject, placeholders, prBody, starterFiles } from "../src/starter.ts";
import type { GitHub } from "../src/github.ts";

const files = starterFiles("owner/app");
const text = (name: string) => files.find((f) => f.path.endsWith(name))!.content;
const prompts = files.filter((f) => f.path.endsWith(".md")).map((f) => f.content).join("\n");
const sizes = [...new Set(defaults("o/r").lanes.flatMap((l) => [...l.sizes, ...l.splits]).filter((s) => s !== "none"))];

test("the kit is the prompt set plus .factory.yml, filled in for the repo", () => {
  assert.deepEqual(files.map((f) => f.path), [
    "docs/factory/prompts/builder.md",
    "docs/factory/prompts/common.md",
    "docs/factory/prompts/ideas.md",
    "docs/factory/prompts/maintainer.md",
    "docs/factory/prompts/reviewer.md",
    "docs/factory/prompts/security.md",
    ".factory.yml",
  ]);
  for (const f of files) assert.doesNotMatch(f.content, /\{\{/, `${f.path} has an unfilled {{...}}`);
  assert.match(text("builder.md"), /^# Factory builder \(owner\/app\)/);
  // The default lanes' prompt files are all in the kit, so a lane switched on has a prompt to start from.
  for (const l of defaults("owner/app").lanes.filter((l) => l.prompt.endsWith(".md"))) assert.ok(files.some((f) => f.path === l.prompt), `no ${l.prompt}`);
  assert.match(text("ideas.md"), /\*\*Never add `ready`\*\*/);
  assert.ok(files.filter((f) => f.path.endsWith(".md")).every((f) => placeholders(f.content) > 0), "each prompt marks what to fill in");
  const other = starterFiles("owner/app", "agents");
  assert.equal(other[0].path, "agents/builder.md");
  assert.match(other[0].content, /`agents\/common\.md`/);
});

test("the template .factory.yml is the built-in defaults written out", () => {
  for (const dir of ["docs/factory/prompts", "agents"]) {
    const yml = starterFiles("owner/app", dir).find((f) => f.path === ".factory.yml")!.content;
    const got = fromYaml("owner/app", yml);
    const want = defaults("owner/app", dir);
    assert.deepEqual(got.lanes, want.lanes);
    assert.equal(got.promptDir, want.promptDir);
    assert.equal(got.maxOpenPrs, want.maxOpenPrs);
  }
});

test("the template prompts mention every convention src/queue.ts relies on", () => {
  // Labels the queue reads: ready, the skips, priorities and every lane's sizes.
  for (const l of ["ready", ...EXCLUDED, ...PRIORITIES, "factory", "factory-stop", "idea"]) assert.ok(prompts.includes("`" + l + "`"), `no \`${l}\``);
  for (const s of sizes) assert.match(prompts, new RegExp(`size:(?:[SMLX]+/)*${s}\\b`), `no size:${s}`);
  // Draft PRs are continued on claude/issue-<n>-* branches, and the builder's branch names match that.
  assert.match(text("builder.md"), /`claude\/issue-<n>-\*`/);
  const branch = text("builder.md").match(/`(claude\/issue-<number>-<short-slug>)`/)![1];
  assert.equal(issueOfPull({ number: 1, title: "", draft: false, body: "", labels: [], branch: branch.replace("<number>", "7").replace("<short-slug>", "x") }), 7);
  // PRs name their card; agents' comments carry the marker; blocked lines use the queue's phrasing.
  assert.equal(issueOfPull({ number: 1, title: "", draft: false, branch: "other", labels: [], body: text("builder.md").match(/^Closes #<n>$/m)![0].replace("<n>", "9") }), 9);
  assert.ok(text("builder.md").includes(MARKER) && text("common.md").includes(MARKER));
  assert.ok(isAgent({ author: "ms", body: `hi\n${MARKER}` }));
  for (const phrase of ["Blocked by #55", "Blocked on #55", "Waits on #55", "Depends on #55"]) {
    assert.ok(text("common.md").includes(phrase), phrase);
    assert.deepEqual(blockersIn(phrase), [55]);
  }
  // Order, and the commit line PR scores read the model from.
  assert.match(text("builder.md"), /`p1`, `p2`,\s+`p3`, then no priority; ties go to the lowest issue number/);
  assert.match(text("builder.md"), /Co-Authored-By: Claude <your model>/);
});

test("one label list: everything the queue and the prompts' Labels tables name", () => {
  const names = new Set(LABELS.map((l) => l.name));
  for (const l of ["ready", ...EXCLUDED, ...PRIORITIES, ...sizes.map((s) => "size:" + s)]) assert.ok(names.has(l), l);
  // This repo's own prompts are left out of public copies (scripts/private-paths.txt): check them when present.
  const own = new URL("../docs/factory/prompts/common.md", import.meta.url);
  for (const md of [text("common.md"), ...(existsSync(own) ? [readFileSync(own, "utf8")] : [])]) {
    const table = md.split("## Labels")[1].split("\n## ")[0].split("\n").filter((l) => l.startsWith("| `"));
    for (const row of table) {
      for (const [, token] of row.split("|")[1].matchAll(/`([^`]+)`/g)) {
        const [head, ...more] = token.split("/");
        const all = head.startsWith("size:") ? [head, ...more.map((m) => "size:" + m)] : [head];
        for (const l of all) assert.ok(names.has(l), `${l} is in a Labels table but not in src/labels.ts`);
      }
    }
  }
  for (const l of LABELS) assert.match(l.color, /^[0-9a-f]{6}$/);
});

test("missing labels ignore case, as GitHub does", () => {
  const missing = missingLabels(["Ready", "p1", "SIZE:S", "bug"]).map((l) => l.name);
  assert.ok(!missing.includes("ready") && !missing.includes("size:S") && !missing.includes("p1"));
  assert.ok(missing.includes("factory-stop"));
  assert.equal(missingLabels(LABELS.map((l) => l.name)).length, 0);
});

test("the starter PR's body lists what to fill in and carries the marker", () => {
  const body = prBody([{ path: "a.md", content: "[FILL IN: x] [FILL IN: y]" }, { path: ".factory.yml", content: "" }], ["b.md"]);
  assert.match(body, /`a\.md`: 2 placeholders/);
  assert.match(body, /`\.factory\.yml`: no placeholders/);
  assert.match(body, /Already here, left alone: `b\.md`/);
  assert.ok(body.trimEnd().endsWith(MARKER));
});

test("a failed file or PR after the branch exists removes the branch, or says to", async () => {
  for (const deleteOk of [true, false]) {
    const calls: string[] = [];
    const gh = {
      maybe: async (p: string) => (p === "/repos/o/r" ? { default_branch: "main" } : undefined),
      all: async () => LABELS.map((l) => ({ name: l.name })),
      request: async (method: string, path: string) => {
        calls.push(`${method} ${path}`);
        if (method === "GET") return { ok: true, status: 200, text: JSON.stringify({ object: { sha: "abc" } }) };
        if (method === "PUT" && path.endsWith("/common.md")) return { ok: false, status: 409, text: "conflict" };
        if (method === "DELETE") return { ok: deleteOk, status: deleteOk ? 204 : 403, text: "" };
        return { ok: true, status: 201, text: "{}" };
      },
    } as unknown as GitHub;
    await assert.rejects(initProject(gh, "o/r", false, () => {}), (e: Error) => {
      assert.match(e.message, /GitHub 409 adding docs\/factory\/prompts\/common\.md/);
      assert.match(e.message, deleteOk ? /Nothing was left behind/ : /Delete the factory\/starter-kit branch on o\/r/);
      return true;
    });
    assert.ok(calls.includes("DELETE /repos/o/r/git/refs/heads/factory/starter-kit"));
    assert.ok(!calls.some((c) => c.endsWith("/pulls")), "no PR after a failed file");
  }
});
