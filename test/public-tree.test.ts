// The public copy names no one deployment: every file scripts/publish-snapshot.sh would publish (the repo's
// files minus scripts/private-paths.txt) is checked for the words in test/banned-words.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BANNED } from "./banned-words.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Unavoidable mentions, as "path: word name" with why. None so far; add one only when the word can't be
 * reworded (say, a third party's product name a script must match), and say why next to it.
 */
const ALLOWED: Record<string, string> = {};

/** A private-paths.txt line as a pattern over repo paths: `**` any depth, `*` and `?` within a name. */
function leftOut(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") (re += ".*"), i++;
    else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}(?:/|$)`);
}

/** The files the snapshot would publish: tracked and new (not ignored), minus the private paths. */
function publicFiles(): string[] {
  const listed = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean);
  const paths = readFileSync(join(root, "scripts", "private-paths.txt"), "utf8")
    .split(/\r?\n/)
    .map((l) => l.replace(/#.*/, "").trim().replace(/\/+$/, ""))
    .filter(Boolean)
    .map(leftOut);
  return [...new Set(listed)].filter((f) => f !== "scripts/private-values.txt" && !paths.some((p) => p.test(f)) && existsSync(join(root, f)));
}

test("the private-paths patterns leave out what the snapshot script does", () => {
  assert.ok(leftOut("examples/owner-homelab").test("examples/owner-homelab/README.md"));
  assert.ok(leftOut("docs/factory/prompts").test("docs/factory/prompts/builder.md"));
  assert.ok(!leftOut("docs/factory/prompts").test("docs/factory/prompts-old/a.md"));
  assert.ok(leftOut("**/*.local.md").test("a/b/c.local.md") && !leftOut("*.md").test("a/b.md"));
});

test("the public tree names no one deployment: no project, account, machine or owner's issue", () => {
  const files = publicFiles();
  assert.ok(files.includes("README.md") && files.includes("src/queue.ts"), "lists the repo's files");
  assert.ok(!files.some((f) => f.startsWith("examples/owner-homelab/")), "leaves out the private paths");
  const found: string[] = [];
  for (const f of files) {
    const buf = readFileSync(join(root, f));
    if (buf.includes(0)) continue; // binary
    const lines = buf.toString("utf8").split("\n");
    lines.forEach((line, i) => {
      for (const b of BANNED) if (b.re.test(line) && !ALLOWED[`${f}: ${b.name}`]) found.push(`${f}:${i + 1}: ${b.name}`);
    });
    for (const b of BANNED) if (b.re.test(f) && !ALLOWED[`${f}: ${b.name}`]) found.push(`${f}: ${b.name} in the path`);
  }
  assert.deepEqual(found, [], `reword these generically, or move the file to a private path:\n${found.join("\n")}`);
});
