// What a card waiting on the owner actually wants: a question to answer, or something to do or check.
// The agent's newest comment decides; status notes ("Not done yet", triage) aren't questions.

export type ThreadComment = { author: string; at: string; body: string; kind: string; bot: boolean };
export type Thread = { number: number; title: string; body: string; state: string; created: string; author: string; labels: string[]; pr: boolean; comments: ThreadComment[] };

/** The text a person reads: no HTML comments, no folded details, no trailing marker lines. */
export function plain(body: string): string {
  return body
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<details>[\s\S]*?<\/details>/g, "")
    .trim();
}

/** The part of a comment above its folded details (what to show first), and the rest. */
export function split(body: string): { head: string; rest: string } {
  const text = body.replace(/<!--[\s\S]*?-->/g, "").trim();
  const fold = text.search(/^\s*<details>/m);
  return fold < 0 ? { head: text, rest: "" } : { head: text.slice(0, fold).trim(), rest: text.slice(fold) };
}

const ASKS = /\?\s*(\*\*)?\s*$|^\s*(\*\*)?(which|should i|do you want|want me to|can you|could you|reply|pick|choose|recommended:?)\b|\b(your call|say which|tell me (which|how|whether)|let me know)\b/im;

/** Whether a comment asks the owner something they can answer in words. */
export function isQuestion(body: string): boolean {
  const t = plain(body);
  if (!t) return false;
  if (/^⚠️\s*\*\*not done yet/i.test(t) || /^🤖\s*\*\*factory:\*\*\s*triage/i.test(t)) return false;
  return t.split("\n").some((line) => ASKS.test(line));
}

/** The agent's newest comment, if any. */
export function latestAgent(t: Thread | null | undefined): ThreadComment | null {
  return [...(t?.comments ?? [])].reverse().find((c) => c.bot) ?? null;
}

/** One line saying why a card waits on the owner, from the agent's newest comment (or the card itself). */
export function why(t: Thread | null | undefined): string {
  const c = latestAgent(t);
  const text = plain(c?.body ?? t?.body ?? "")
    .replace(/^🤖\s*/u, "")
    .replace(/\*\*Factory( reviewer)?:\*\*\s*/i, "")
    .replace(/^⚠️\s*/u, "")
    .replace(/\*\*/g, "")
    .replace(/`/g, "");
  const first = text.split(/\n+/).find((l) => l.trim() && !/^#+\s*$/.test(l)) ?? "";
  return first.replace(/^#+\s*/, "").trim().slice(0, 220);
}
