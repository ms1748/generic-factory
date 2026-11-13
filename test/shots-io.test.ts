// The screenshots' I/O edges with stubs: runShots against a fake `docker` on PATH, GitHub.upload against a
// stubbed fetch, and postShots end to end with a fake GitHub client. No real container, network or token.
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, afterEach, beforeEach, mock, test } from "node:test";
import type { Ctx } from "../src/dispatch.ts";
import { GitHub } from "../src/github.ts";
import { env, runShots } from "../src/runner.ts";
import { DEVICES, postShots, RELEASE_TAG, shotSpec } from "../src/shots.ts";
import type { Shot, ShotSpec } from "../src/shots.ts";
import { useExample } from "./example-install.ts";

const PATH = process.env.PATH;
const bin = mkdtempSync(join(tmpdir(), "factory-shots-"));
after(() => rmSync(bin, { recursive: true, force: true }));
beforeEach(() => {
  for (const f of ["args", "env", "pid", "killed"]) rmSync(join(bin, f), { force: true });
  process.env.PATH = `${bin}:${PATH}`;
});
afterEach(() => {
  process.env.PATH = PATH;
});

/**
 * A fake `docker` in `bin`: `docker run` records its arguments, environment and pid, then runs `body`;
 * `docker kill` records its arguments and kills the recorded run.
 */
function fakeDocker(body: string): void {
  const script = `#!/bin/sh
D=$(dirname "$0")
if [ "$1" = kill ]; then printf '%s\\n' "$@" > "$D/killed"; kill "$(cat "$D/pid")"; exit 0; fi
printf '%s\\n' "$@" > "$D/args"
env > "$D/env"
echo $$ > "$D/pid"
${body}
`;
  writeFileSync(join(bin, "docker"), script);
  chmodSync(join(bin, "docker"), 0o755);
}

const line = (s: Shot) => `echo '${JSON.stringify(s)}'`;
const spec: ShotSpec = { before: "https://site.example.dev", after: "https://claude-issue-9.site.example.dev", pages: ["/"], devices: DEVICES };
const logs: string[] = [];
const log = (l: string) => logs.push(l);

// runShots

test("runShots: a locked-down container that gets the spec and no GitHub token", async () => {
  fakeDocker(line({ page: "/", device: "desktop", side: "before", png: "AA==" }));
  process.env.GH_TOKEN = "must-not-leak";
  process.env.CF_ACCESS_CLIENT_ID = "access-id";
  try {
    await runShots(41, spec, log);
  } finally {
    delete process.env.GH_TOKEN;
    delete process.env.CF_ACCESS_CLIENT_ID;
  }
  const args = readFileSync(join(bin, "args"), "utf8").trim().split("\n");
  assert.deepEqual(args.slice(0, 4), ["run", "--rm", "--name", "factory-shots-41"]);
  for (const flag of [["--cap-drop", "ALL"], ["--security-opt", "no-new-privileges"], ["--pids-limit", "1024"]]) {
    assert.equal(args[args.indexOf(flag[0]) + 1], flag[1], flag[0]);
  }
  assert.ok(!args.includes("-v") && !args.includes("--volume") && !args.includes("--privileged"), "no mounts, not privileged");
  assert.deepEqual(args.slice(-3), [env.image, "node", "/opt/shots/shots.mjs"]);
  // Only names are passed with -e; their values come from docker's own environment.
  assert.deepEqual(args.filter((_, i) => args[i - 1] === "-e"), ["FACTORY_SHOTS", "CF_ACCESS_CLIENT_ID", "CF_ACCESS_CLIENT_SECRET"]);
  const childEnv = readFileSync(join(bin, "env"), "utf8");
  assert.ok(childEnv.includes(`FACTORY_SHOTS=${JSON.stringify(spec)}`));
  assert.ok(childEnv.includes("CF_ACCESS_CLIENT_ID=access-id"));
  assert.ok(!childEnv.includes("must-not-leak"), "the GitHub token stays out");
});

test("runShots: keeps the shot lines, skips everything else", async () => {
  const good: Shot[] = [
    { page: "/", device: "desktop", side: "before", png: "AA==" },
    { page: "/", device: "phone", side: "after", error: "HTTP 404" },
  ];
  fakeDocker(
    [
      "echo 'Chromium starting'",
      line(good[0]),
      `echo '{"page":"/","device":"desktop","side":"sideways","png":"AA=="}'`,
      `echo '{"device":"desktop","side":"after"}'`,
      `echo '{"page":"/",'`,
      line(good[1]),
    ].join("\n"),
  );
  assert.deepEqual(await runShots(1, spec, log), good);
});

test("runShots: nothing out gives one error shot with the last stderr line, or the exit code", async () => {
  fakeDocker("echo 'pulling' >&2\necho 'Error: page crashed' >&2\nexit 3");
  assert.deepEqual(await runShots(1, spec, log), [{ page: "/", device: "desktop", side: "after", error: "Error: page crashed" }]);
  fakeDocker("exit 3");
  assert.deepEqual(await runShots(1, spec, log), [{ page: "/", device: "desktop", side: "after", error: "exit code 3" }]);
});

test("runShots: no docker at all is an error shot, not a throw", async () => {
  const empty = mkdtempSync(join(tmpdir(), "factory-nodocker-"));
  process.env.PATH = empty;
  try {
    const [s] = await runShots(1, spec, log);
    assert.match(s.error ?? "", /^could not start docker: .*ENOENT/);
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
});

test("runShots: past the time limit the container is killed and the run still returns", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  fakeDocker(`${line({ page: "/", device: "desktop", side: "before", png: "AA==" })}\nexec sleep 30`);
  logs.length = 0;
  const done = runShots(77, spec, log);
  // Wait until the fake container is up, then jump past the two minutes.
  while (!existsSync(join(bin, "pid"))) await new Promise((r) => setImmediate(r));
  t.mock.timers.tick(2 * 60_000);
  const shots = await done;
  assert.deepEqual(readFileSync(join(bin, "killed"), "utf8").trim().split("\n"), ["kill", "factory-shots-77"]);
  assert.ok(logs.some((l) => l.includes("run 77: the screenshots took over 2 minutes")));
  assert.equal(shots.length, 1);
  assert.equal(shots[0].png, "AA==");
});

// GitHub.upload

test("upload: posts the bytes to the release's upload address and returns the asset", async () => {
  process.env.GH_TOKEN = "test-token";
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchMock = mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ browser_download_url: "https://github.com/o/r/releases/download/t/a.png" }), { status: 201 });
  });
  try {
    const gh = new GitHub();
    const a = await gh.upload("https://uploads.github.com/repos/o/r/releases/9/assets{?name,label}", "pr1 run/2.png", Buffer.from([1, 2, 3]), "image/png");
    assert.equal(a.browser_download_url, "https://github.com/o/r/releases/download/t/a.png");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://uploads.github.com/repos/o/r/releases/9/assets?name=pr1%20run%2F2.png");
    assert.equal(calls[0].init.method, "POST");
    const headers = calls[0].init.headers as Record<string, string>;
    assert.equal(headers.Authorization, "Bearer test-token");
    assert.equal(headers["content-type"], "image/png");
    assert.deepEqual([...(calls[0].init.body as Uint8Array)], [1, 2, 3]);
  } finally {
    fetchMock.mock.restore();
    delete process.env.GH_TOKEN;
  }
});

test("upload: refuses any address but GitHub's upload host, before sending anything", async () => {
  process.env.GH_TOKEN = "test-token";
  const fetchMock = mock.method(globalThis, "fetch", async () => new Response("{}"));
  try {
    const gh = new GitHub();
    await assert.rejects(gh.upload("https://evil.example/assets{?name,label}", "a.png", Buffer.from([1]), "image/png"), /not a GitHub upload address/);
    await assert.rejects(gh.upload("https://uploads.github.com.evil.example/x", "a.png", Buffer.from([1]), "image/png"), /not a GitHub upload address/);
    assert.equal(fetchMock.mock.callCount(), 0);
  } finally {
    fetchMock.mock.restore();
    delete process.env.GH_TOKEN;
  }
});

test("upload: GitHub's error comes back with its status", async () => {
  process.env.GH_TOKEN = "test-token";
  const fetchMock = mock.method(globalThis, "fetch", async () => new Response("asset already exists", { status: 422 }));
  try {
    await assert.rejects(new GitHub().upload("https://uploads.github.com/x{?name}", "a.png", Buffer.from([1]), "image/png"), /GitHub 422 uploading a\.png: asset already exists/);
  } finally {
    fetchMock.mock.restore();
    delete process.env.GH_TOKEN;
  }
});

// postShots

const UPLOAD_URL = "https://uploads.github.com/repos/owner/site/releases/5/assets{?name,label}";

/** A fake GitHub client: answers from `over`, records every call. */
function fakeGh(over: Partial<Record<"files" | "release" | "create" | "upload", unknown>> = {}) {
  const calls: { fn: string; args: unknown[] }[] = [];
  const gh = {
    all: async (...args: unknown[]) => (calls.push({ fn: "all", args }), over.files ?? [{ filename: "website/index.html" }]),
    maybe: async (...args: unknown[]) => (calls.push({ fn: "maybe", args }), "release" in over ? over.release : { id: 5, upload_url: UPLOAD_URL }),
    request: async (...args: unknown[]) => (calls.push({ fn: "request", args }), over.create ?? { ok: true, status: 201, text: JSON.stringify({ id: 6, upload_url: UPLOAD_URL }) }),
    upload: async (...args: unknown[]) => {
      calls.push({ fn: "upload", args });
      if (over.upload instanceof Error) throw over.upload;
      return { browser_download_url: `https://github.com/owner/site/releases/download/${RELEASE_TAG}/${args[1]}` };
    },
    send: async (...args: unknown[]) => void calls.push({ fn: "send", args }),
  };
  return { gh, calls, fns: () => calls.map((c) => c.fn) };
}

function ctxWith(gh: ReturnType<typeof fakeGh>["gh"], on = true, previewHost = "site-previews.pages.dev"): Ctx {
  const state = useExample({ previewHost });
  state.setShotsOn(on);
  logs.length = 0;
  return { gh: gh as unknown as GitHub, state, repo: "owner/site", log };
}

const PR = { number: 12, ref: "claude/issue-9-hero" };
const shotLines = (...shots: Shot[]) => shots.map(line).join("\n");

test("postShots: does nothing while the switch is off", async () => {
  fakeDocker(shotLines({ page: "/", device: "desktop", side: "before", png: "AA==" }));
  const f = fakeGh();
  await postShots(ctxWith(f.gh, false), PR, ["/"], 3);
  assert.deepEqual(f.calls, []);
  assert.ok(!existsSync(join(bin, "args")), "no container");
});

test("postShots: no container for a PR without UI files", async () => {
  fakeDocker("");
  const f = fakeGh({ files: [{ filename: "src/queue.ts" }, { filename: "README.md" }] });
  await postShots(ctxWith(f.gh), PR, ["/"], 3);
  assert.deepEqual(f.fns(), ["all"]);
  assert.equal(f.calls[0].args[0], "/repos/owner/site/pulls/12/files");
  assert.ok(!existsSync(join(bin, "args")));
});

test("postShots: without a preview host it says so and stops", async () => {
  fakeDocker("");
  const f = fakeGh();
  await postShots(ctxWith(f.gh, true, ""), PR, ["/"], 3);
  assert.deepEqual(f.fns(), ["all"]);
  assert.deepEqual(logs, ["shots: PR #12 touches UI files, but Settings › Install has no preview host"]);
  assert.ok(!existsSync(join(bin, "args")));
});

test("postShots: shoots the branch's preview, uploads what came out and posts one comment", async () => {
  fakeDocker(
    shotLines(
      { page: "/download", device: "desktop", side: "before", png: "AQI=" },
      { page: "/download", device: "desktop", side: "after", png: "AwQ=" },
      { page: "/download", device: "phone", side: "before", error: "HTTP 404" },
      { page: "/download", device: "phone", side: "after", png: "BQY=" },
    ),
  );
  const f = fakeGh();
  await postShots(ctxWith(f.gh), PR, ["/download", "https://evil.example/"], 3);

  const given = readFileSync(join(bin, "env"), "utf8").match(/^FACTORY_SHOTS=(.*)$/m)![1];
  assert.deepEqual(JSON.parse(given), shotSpec(PR.ref, ["/download"], "site-previews.pages.dev"));

  assert.deepEqual(f.fns(), ["all", "maybe", "upload", "upload", "upload", "send"]);
  assert.equal(f.calls[1].args[0], `/repos/owner/site/releases/tags/${RELEASE_TAG}`);
  const ups = f.calls.filter((c) => c.fn === "upload").map((c) => c.args);
  assert.deepEqual(ups.map((a) => a[0]), [UPLOAD_URL, UPLOAD_URL, UPLOAD_URL]);
  assert.deepEqual(ups.map((a) => a[1]), ["pr12-run3-download-desktop-before.png", "pr12-run3-download-desktop-after.png", "pr12-run3-download-phone-after.png"]);
  assert.deepEqual([...(ups[0][2] as Buffer)], [1, 2]);
  assert.equal(ups[0][3], "image/png");

  const [method, path, payload] = f.calls.at(-1)!.args as [string, string, { body: string }];
  assert.equal(method, "POST");
  assert.equal(path, "/repos/owner/site/issues/12/comments");
  assert.match(payload.body, /pr12-run3-download-desktop-after\.png/);
  assert.match(payload.body, /\| Phone \| _no image: HTTP 404_ \|/);
  assert.match(logs.at(-1)!, /^shots: PR #12: 3 of 4 screenshots posted \(\d+ s\)$/);
});

test("postShots: creates the screenshots release as a pre-release the first time", async () => {
  fakeDocker(shotLines({ page: "/", device: "desktop", side: "after", png: "AA==" }));
  const f = fakeGh({ release: undefined });
  await postShots(ctxWith(f.gh), PR, [], 3);
  assert.deepEqual(f.fns(), ["all", "maybe", "request", "upload", "send"]);
  const [method, path, body] = f.calls[2].args as [string, string, Record<string, unknown>];
  assert.equal(method, "POST");
  assert.equal(path, "/repos/owner/site/releases");
  assert.equal(body.tag_name, RELEASE_TAG);
  assert.equal(body.prerelease, true);
  assert.equal(body.make_latest, "false");
});

test("postShots: no screenshots means no release and no comment, just a log line", async () => {
  fakeDocker("echo 'Error: browser failed to launch' >&2\nexit 1");
  const f = fakeGh();
  await postShots(ctxWith(f.gh), PR, ["/"], 3);
  assert.deepEqual(f.fns(), ["all"]);
  assert.deepEqual(logs, ["shots: PR #12: no screenshots (Error: browser failed to launch)"]);
});

test("postShots: a failed release, upload or file list is logged, never thrown, and posts nothing", async () => {
  fakeDocker(shotLines({ page: "/", device: "desktop", side: "after", png: "AA==" }));

  let f = fakeGh({ release: undefined, create: { ok: false, status: 403, text: "Resource not accessible by integration" } });
  await postShots(ctxWith(f.gh), PR, ["/"], 3);
  assert.ok(!f.fns().includes("send"));
  assert.deepEqual(logs, [`shots: PR #12: couldn't create the ${RELEASE_TAG} release: GitHub 403 Resource not accessible by integration`]);

  f = fakeGh({ upload: new Error("GitHub 422 uploading x.png: already_exists") });
  await postShots(ctxWith(f.gh), PR, ["/"], 3);
  assert.ok(!f.fns().includes("send"));
  assert.deepEqual(logs, ["shots: PR #12: GitHub 422 uploading x.png: already_exists"]);

  const g = fakeGh();
  g.gh.all = async () => {
    throw new Error("GitHub 502");
  };
  await postShots(ctxWith(g.gh), PR, ["/"], 3);
  assert.deepEqual(logs, ["shots: PR #12: GitHub 502"]);
});
