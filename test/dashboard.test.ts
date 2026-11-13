import assert from "node:assert/strict";
import { generateKeyPairSync, createSign } from "node:crypto";
import { test } from "node:test";
import { allowed, verifyAccessJwt } from "../src/access.ts";
import { condense } from "../src/dashboard.ts";
import { budgetBlock } from "../src/dispatch.ts";
import { parseRateLimit } from "../src/runner.ts";
import { State } from "../src/state.ts";

test("transcripts condense to words, tools, results and the outcome", () => {
  const lines = [
    { type: "system", subtype: "init", session_id: "s" },
    { type: "assistant", message: { content: [{ type: "thinking", thinking: "hm" }, { type: "text", text: "Looking at the card." }, { type: "tool_use", name: "Bash", input: { command: "npm test", description: "Run tests" } }] } },
    { type: "user", message: { content: [{ type: "tool_result", content: [{ type: "text", text: "13 passed" }] }] } },
    { type: "user", message: { content: [{ type: "tool_result", is_error: true, content: "boom" }] } },
    { type: "rate_limit_event", rate_limit_info: {} },
    { type: "stderr", text: "warning" },
    { type: "result", result: "Done: PR #5" },
  ];
  const out = condense(lines.map((l) => JSON.stringify(l)).join("\n") + "\nnot json\n");
  assert.deepEqual(out, [
    { kind: "text", text: "Looking at the card." },
    { kind: "tool", name: "Bash", text: "Run tests: npm test" },
    { kind: "result", text: "13 passed" },
    { kind: "error", text: "boom" },
    { kind: "stderr", text: "warning" },
    { kind: "done", text: "Done: PR #5" },
  ]);
});

test("usage windows: parsed, reset windows read as empty, budget holds runs near the limit", () => {
  const now = Date.parse("2026-10-28T12:00:00Z");
  const r = parseRateLimit({
    status: "allowed",
    resetsAt: now / 1000 + 3600,
    unifiedWindows: { five_hour: { utilization: 0.85, resetsAt: now / 1000 + 3600 }, seven_day: { utilization: 0.4, resetsAt: now / 1000 + 86400 } },
  });
  const s = new State(":memory:");
  s.saveUsage(r);
  assert.equal(s.usage(now)?.fiveHour?.utilization, 0.85);
  assert.match(budgetBlock(s, now) ?? "", /5-hour window at 85%/);
  assert.equal(s.usage(now + 2 * 3600_000)?.fiveHour?.utilization, 0); // that window has reset
  assert.equal(budgetBlock(s, now + 2 * 3600_000), undefined);
});

test("Cloudflare Access tokens", async () => {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: "jwk" }), kid: "k1" };
  const team = "team.cloudflareaccess.com";
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ keys: [jwk] }))) as typeof fetch;
  const sign = (claims: object) => {
    const h = Buffer.from(JSON.stringify({ alg: "RS256", kid: "k1" })).toString("base64url");
    const p = Buffer.from(JSON.stringify(claims)).toString("base64url");
    return `${h}.${p}.${createSign("RSA-SHA256").update(`${h}.${p}`).sign(privateKey).toString("base64url")}`;
  };
  const exp = Math.floor(Date.now() / 1000) + 600;
  try {
    assert.equal(await verifyAccessJwt(sign({ aud: ["AUD"], exp, iss: `https://${team}` }), team, "AUD"), true);
    assert.equal(await verifyAccessJwt(sign({ aud: ["OTHER"], exp, iss: `https://${team}` }), team, "AUD"), false);
    assert.equal(await verifyAccessJwt(sign({ aud: ["AUD"], exp: 1, iss: `https://${team}` }), team, "AUD"), false);
    const forged = sign({ aud: ["AUD"], exp, iss: `https://${team}` }).replace(/\.[^.]+$/, ".AAAA");
    assert.equal(await verifyAccessJwt(forged, team, "AUD"), false);

    // Direct (LAN, tailnet, agent containers, the CI runner) requests are refused unless the preview
    // switch is on; tunnel requests need the token and the settings.
    assert.equal((await allowed({ headers: {} } as any)).ok, false);
    process.env.FACTORY_LAN_OPEN = "1";
    assert.equal((await allowed({ headers: {} } as any)).ok, true);
    delete process.env.FACTORY_LAN_OPEN;
    delete process.env.CF_ACCESS_AUD;
    assert.equal((await allowed({ headers: { "cf-connecting-ip": "1.2.3.4" } } as any)).ok, false);
    process.env.CF_ACCESS_TEAM_DOMAIN = team;
    process.env.CF_ACCESS_AUD = "AUD";
    const good = sign({ aud: ["AUD"], exp, iss: `https://${team}` });
    assert.equal((await allowed({ headers: { "cf-connecting-ip": "1.2.3.4", "cf-access-jwt-assertion": good } } as any)).ok, true);
    assert.equal((await allowed({ headers: { "cf-connecting-ip": "1.2.3.4" } } as any)).ok, false);
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.CF_ACCESS_AUD;
    delete process.env.CF_ACCESS_TEAM_DOMAIN;
  }
});

test("issue descriptions render safely", async () => {
  // @ts-ignore: plain JS module from the page
  const { md } = await import("../web/src/lib/md.js");
  const html: string = md('**Why.** see #23 and [docs](https://x.dev/a)\n<img src=x onerror=alert(1)>\n[bad](javascript:alert(1))\n- [x] done\n- item `code`\n<!-- old-factory -->', "o/r");
  assert.match(html, /<strong>Why\.<\/strong>/);
  assert.match(html, /href="https:\/\/github.com\/o\/r\/issues\/23"/);
  assert.match(html, /<a href="https:\/\/x.dev\/a"/);
  assert.doesNotMatch(html, /<img|javascript:alert\(1\)"|old-factory/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /<li>☑ done<\/li>/);
  assert.match(html, /<code>code<\/code>/);
});

test("a used-up window blocks new runs unless paid credits are on; overage is read from the event", () => {
  const s = new State(":memory:");
  const r = parseRateLimit({ status: "rejected", isUsingOverage: true, unifiedWindows: { five_hour: { utilization: 0.5, resetsAt: Date.now() / 1000 + 3600 } } });
  assert.equal(r.overage, true);
  s.saveUsage(r);
  assert.match(budgetBlock(s) ?? "", /paid credits are off/);
  s.setAllowCredits(true);
  assert.equal(s.allowCredits(), true);
  assert.equal(budgetBlock(s), undefined);
});

test("a used-up window stops blocking once it resets, even before the next usage report", () => {
  const s = new State(":memory:");
  const past = Date.now() / 1000 - 60;
  s.saveUsage(parseRateLimit({ status: "rejected", resetsAt: past, unifiedWindows: { five_hour: { utilization: 1, resetsAt: past } } }));
  assert.equal(s.usage()?.status, "allowed");
  assert.equal(budgetBlock(s), undefined);
});

test("only a maintainer run gets the GlitchTip token, where Settings says", async () => {
  const { reportsEnv } = await import("../src/runner.ts");
  const env = { GLITCHTIP_TOKEN: "t" } as NodeJS.ProcessEnv;
  const where = { url: "https://crash.example.com", org: "example" };
  assert.deepEqual(reportsEnv(true, env, where), { GLITCHTIP_URL: "https://crash.example.com", GLITCHTIP_ORG: "example", GLITCHTIP_TOKEN: "t" });
  assert.deepEqual(reportsEnv(true, env, { url: "", org: "" }).GLITCHTIP_TOKEN, "", "no GlitchTip address: off");
  assert.deepEqual(reportsEnv(false, env), { GLITCHTIP_URL: "", GLITCHTIP_ORG: "", GLITCHTIP_TOKEN: "" });
  assert.deepEqual(reportsEnv(true, {} as NodeJS.ProcessEnv).GLITCHTIP_TOKEN, "");
});
