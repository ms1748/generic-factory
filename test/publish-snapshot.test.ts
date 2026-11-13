// scripts/publish-snapshot.sh against a throwaway repo: what it leaves out, what makes it refuse, and that
// it never prints a private value.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const script = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "publish-snapshot.sh");
const ident = { GIT_AUTHOR_NAME: "Public Name", GIT_AUTHOR_EMAIL: "public@example.com", GIT_COMMITTER_NAME: "Public Name", GIT_COMMITTER_EMAIL: "public@example.com" };
const env = { ...process.env, ...ident, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
const PRIVATE = "secret-host.internal.example";

function run(cmd: string, args: string[], cwd: string, extra: Record<string, string> = {}) {
  return spawnSync(cmd, args, { cwd, env: { ...env, ...extra }, encoding: "utf8" });
}

/** A repo with the script, a private folder, and a clean public file; `files` adds or replaces files. */
function repo(files: Record<string, string> = {}, values = `# private values\n\n${PRIVATE}\n`) {
  const root = mkdtempSync(join(tmpdir(), "snapshot-"));
  const dir = join(root, "repo");
  const all: Record<string, string> = {
    ".gitignore": "scripts/private-values.txt\n",
    "README.md": "# Public\n",
    "src/app.ts": "export const x = 1;\n",
    "examples/home/notes.md": `the box is ${PRIVATE}\n`,
    "scripts/private-paths.txt": "# left out\nscripts/private-paths.txt\nexamples/home/\nnothing/here\n",
    ...files,
  };
  for (const [name, body] of Object.entries(all)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), body);
  }
  cpSync(script, join(dir, "scripts", "publish-snapshot.sh"));
  run("git", ["init", "-q", "-b", "main"], dir);
  run("git", ["add", "-A"], dir);
  assert.equal(run("git", ["commit", "-q", "-m", "init"], dir).status, 0);
  if (values !== "") writeFileSync(join(dir, "scripts", "private-values.txt"), values);
  return { root, dir, out: join(root, "out") };
}

function snapshot(r: { dir: string; out: string }, extra: Record<string, string> = {}) {
  const res = run("bash", ["scripts/publish-snapshot.sh", r.out], r.dir, extra);
  return { status: res.status, text: res.stdout + res.stderr };
}

test("a clean tree becomes one commit without the private paths", () => {
  const r = repo();
  try {
    const res = snapshot(r);
    assert.equal(res.status, 0, res.text);
    assert.ok(!existsSync(join(r.out, "examples", "home")));
    assert.ok(!existsSync(join(r.out, "scripts", "private-paths.txt")));
    assert.ok(!existsSync(join(r.out, "scripts", "private-values.txt")));
    assert.ok(existsSync(join(r.out, "scripts", "publish-snapshot.sh")));
    assert.equal(run("git", ["rev-list", "--count", "HEAD"], r.out).stdout.trim(), "1");
    assert.equal(run("git", ["log", "-1", "--format=%an <%ae>"], r.out).stdout.trim(), "Public Name <public@example.com>");
    assert.equal(run("git", ["remote"], r.out).stdout.trim(), "", "never adds a remote or pushes");
    assert.match(res.text, /left out: examples\/home/);
    assert.match(res.text, /nothing matches 'nothing\/here'/);
    assert.match(res.text, /src\/app\.ts/, "lists what it would publish");
    // The copy passes its own checks: the script, run inside it with the same values, publishes again.
    writeFileSync(join(r.out, ".gitignore"), "scripts/private-values.txt\n");
    run("git", ["commit", "-qam", "ignore"], r.out);
    writeFileSync(join(r.out, "scripts", "private-values.txt"), `${PRIVATE}\n`);
    const again = run("bash", ["scripts/publish-snapshot.sh", join(r.root, "out2")], r.out);
    assert.equal(again.status, 0, again.stdout + again.stderr);
  } finally {
    rmSync(r.root, { recursive: true, force: true });
  }
});

test("a private value anywhere refuses, names the place, never the value", () => {
  const r = repo({ "docs/setup.md": "line one\nssh SECRET-HOST.internal.example\n", [`notes-${PRIVATE}.txt`]: "x\n" });
  try {
    const res = snapshot(r);
    assert.equal(res.status, 1);
    assert.match(res.text, /docs\/setup\.md:2: private value on line 3 of scripts\/private-values\.txt/);
    assert.match(res.text, /1 file or folder name\(s\): private value on line 3/);
    assert.ok(!res.text.toLowerCase().includes(PRIVATE), "the value itself is never printed");
    assert.ok(!existsSync(r.out), "nothing written");
  } finally {
    rmSync(r.root, { recursive: true, force: true });
  }
});

test("secrets refuse: keys, tokens, filled-in .env keys, secret files", () => {
  const pem = ["-----BEGIN", "RSA PRIVATE KEY-----"].join(" ");
  const r = repo({
    "a.txt": `${pem}\n`,
    "b.txt": `token ${"ghp_" + "a".repeat(36)}\n`,
    "c.env.example": "WEBHOOK_SECRET=abc123\nGH_APP_ID=\nWEBHOOK_SECRET=<yours>\n",
    "config/.env": "X=1\n",
    "app.pem": "x\n",
  });
  try {
    const res = snapshot(r);
    assert.equal(res.status, 1, res.text);
    assert.match(res.text, /a\.txt:1: private key/);
    assert.match(res.text, /b\.txt:1: GitHub token/);
    assert.match(res.text, /c\.env\.example:1: filled-in secret/);
    assert.doesNotMatch(res.text, /c\.env\.example:3/, "a placeholder isn't a secret");
    assert.match(res.text, /config\/\.env: a secrets file/);
    assert.match(res.text, /app\.pem: a secrets file/);
    assert.ok(!existsSync(r.out));
  } finally {
    rmSync(r.root, { recursive: true, force: true });
  }
});

test("a private commit identity refuses", () => {
  const r = repo();
  try {
    const res = snapshot(r, { GIT_AUTHOR_EMAIL: `me@${PRIVATE}` });
    assert.equal(res.status, 1);
    assert.match(res.text, /the commit's author: private value/);
  } finally {
    rmSync(r.root, { recursive: true, force: true });
  }
});

test("refuses without a usable private-values file, or into a used folder", () => {
  const missing = repo({}, "");
  const empty = repo({}, "# nothing yet\n\n");
  const tracked = repo({ ".gitignore": "", "scripts/private-values.txt": `${PRIVATE}\n` });
  const used = repo();
  try {
    assert.match(snapshot(missing).text, /private-values\.txt is missing/);
    assert.match(snapshot(empty).text, /has no values/);
    assert.match(snapshot(tracked).text, /is committed/);
    mkdirSync(used.out);
    writeFileSync(join(used.out, "keep.txt"), "x");
    const res = snapshot(used);
    assert.equal(res.status, 1);
    assert.match(res.text, /isn't empty/);
    assert.deepEqual(readdirSync(used.out), ["keep.txt"]);
    assert.match(run("bash", ["scripts/publish-snapshot.sh", join(used.dir, "inside")], used.dir).stderr, /outside this repo/);
  } finally {
    for (const r of [missing, empty, tracked, used]) rmSync(r.root, { recursive: true, force: true });
  }
});
