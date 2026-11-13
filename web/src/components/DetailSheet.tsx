// The details sheet: a card or PR (labels, links, actions, the description and the whole thread, and a
// reply box when it waits on the owner), a lane's prompt, or a trial report. Opened from anywhere with
// openItem / openPrompt / openTrial (lib/overlays.ts).
import * as React from "react";
import { ExternalLinkIcon, GitPullRequestIcon, HammerIcon, PauseIcon, PlayIcon, RotateCcwIcon, SendIcon, BotIcon, UserIcon } from "lucide-react";
import { control, getJson, useStore } from "@/lib/api";
import { closeDetail, buildNow, useOverlays, type Item } from "@/lib/overlays";
import { gh, rel, time, short } from "@/lib/format";
import { go } from "@/lib/router";
import { split, type Thread } from "@/lib/questions";
import { Sheet, SheetContent } from "./ui/overlays";
import { Button } from "./ui/button";
import { Badge, Skeleton, Textarea } from "./ui/primitives";
import { Markdown } from "./patterns";
import { TestBuilds } from "./TestBuilds";
import { cn } from "@/lib/utils";

const WHERE: Record<string, string> = { next: "Up next", building: "Building", review: "In review", needsYou: "Waiting on you", hold: "On hold", ideas: "Idea", blocked: "Blocked", done: "Done" };

export function DetailSheet() {
  const { detail } = useOverlays();
  const { data: d } = useStore();
  return (
    <Sheet open={Boolean(detail)} onOpenChange={(o) => !o && closeDetail()}>
      {detail?.type === "item" && d && <ItemSheet item={detail.item} primary={d.repo} timezone={d.timezone} />}
      {detail?.type === "prompt" && d && <TextSheet title={detail.path.split("/").pop() ?? detail.path} sub="The prompt the agents follow" url={`/api/prompt?path=${encodeURIComponent(detail.path)}${detail.repo ? `&repo=${encodeURIComponent(detail.repo)}` : ""}`} repo={detail.repo ?? d.repo} link={detail.path.startsWith("docs/") ? `https://github.com/${detail.repo ?? d.repo}/blob/main/${detail.path}` : undefined} />}
      {detail?.type === "trial" && d && <TextSheet title={detail.trial.title} sub={`Quality trial · ${detail.trial.wins}`} url={`/api/trials/${detail.trial.name}`} repo={d.repo} />}
    </Sheet>
  );
}

function TextSheet({ title, sub, url, repo, link }: { title: string; sub: string; url: string; repo: string; link?: string }) {
  const [text, setText] = React.useState<string | null>(null);
  React.useEffect(() => {
    setText(null);
    getJson<{ text?: string; error?: string }>(url).then((j) => setText(j?.text ?? j?.error ?? "Couldn't load it."));
  }, [url]);
  return (
    <SheetContent wide title={title} description={<span className="flex items-center gap-2">{sub}{link && <a className="inline-flex items-center gap-1 text-brand hover:underline" href={link} target="_blank" rel="noopener">on GitHub <ExternalLinkIcon className="size-3" /></a>}</span>}>
      <div className="p-5">{text == null ? <Lines /> : <Markdown text={text} repo={repo} />}</div>
    </SheetContent>
  );
}

function Lines() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-5/6" />
    </div>
  );
}

function ItemSheet({ item: c, primary, timezone }: { item: Item; primary: string; timezone: string }) {
  const repo = c.repo ?? primary;
  const isPr = Boolean(c.isPr || c.column === "review");
  const [t, setT] = React.useState<Thread | null | "error">(null);
  const load = React.useCallback(() => {
    getJson<Thread>(`/api/issues/${c.number}${repo !== primary ? `?repo=${encodeURIComponent(repo)}` : ""}`).then((j) => setT(j ?? "error"));
  }, [c.number, repo, primary]);
  React.useEffect(() => {
    setT(null);
    load();
  }, [load]);
  const thread = t && t !== "error" ? t : null;
  const labels = (thread?.labels ?? c.labels ?? []).filter((l) => !/^(p\d|size:)/.test(l));
  const waiting = c.column === "needsYou" || thread?.labels.includes("needs-owner");

  return (
    <SheetContent
      wide
      title={
        <span>
          <a href={gh(repo, isPr ? "pull" : "issues", c.number)} target="_blank" rel="noopener" className="mr-1.5 font-mono text-muted-foreground hover:text-brand">
            {repo !== primary ? short(repo) : ""}#{c.number}
          </a>
          {c.title}
        </span>
      }
      description={
        <div className="flex flex-wrap items-center gap-1.5">
          {c.column && <Badge variant={c.column === "needsYou" ? "warn" : c.column === "building" ? "brand" : "outline"}>{WHERE[c.column] ?? c.column}</Badge>}
          {c.priority && <Badge variant={c.priority === "p1" ? "bad" : c.priority === "p2" ? "warn" : "outline"}>{c.priority}</Badge>}
          {c.size && <Badge variant="outline">size {c.size}</Badge>}
          {c.verdict && <Badge variant={c.verdict === "ready" ? "ok" : "warn"}>{c.verdict === "ready" ? "reviewer: ready" : c.verdict}</Badge>}
          {labels.map((l) => (
            <Badge key={l} variant="outline">
              {l}
            </Badge>
          ))}
        </div>
      }
    >
      <div className="flex flex-col gap-5 p-5">
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm" variant="outline">
            <a href={gh(repo, isPr ? "pull" : "issues", c.number)} target="_blank" rel="noopener">
              <ExternalLinkIcon /> Open on GitHub
            </a>
          </Button>
          {c.pr && c.pr !== c.number && (
            <Button asChild size="sm" variant="outline">
              <a href={gh(repo, "pull", c.pr)} target="_blank" rel="noopener">
                <GitPullRequestIcon /> PR #{c.pr}
              </a>
            </Button>
          )}
          {c.issue && (
            <Button asChild size="sm" variant="outline">
              <a href={gh(repo, "issues", c.issue)} target="_blank" rel="noopener">
                Card #{c.issue}
              </a>
            </Button>
          )}
          {c.run && (
            <Button size="sm" variant={c.running ? "brand" : "outline"} onClick={() => (closeDetail(), go("runs", "run", String(c.run)))}>
              <PlayIcon /> {c.running ? "Watch the run" : "See its run"}
            </Button>
          )}
          {!isPr && (c.column === "next" || c.column === "ideas" || c.column === "blocked") && (
            <Button size="sm" variant="outline" onClick={() => buildNow({ number: c.number, title: c.title, repo })}>
              <HammerIcon /> Build now
            </Button>
          )}
          {!isPr && c.column !== "hold" && c.column !== "done" && (
            <Button size="sm" variant="ghost" onClick={() => control(`cards/${c.number}/hold`, { repo })}>
              <PauseIcon /> Hold
            </Button>
          )}
          {!isPr && (c.column === "hold" || c.column === "needsYou") && (
            <Button size="sm" variant="ghost" onClick={() => control(`cards/${c.number}/requeue`, { repo })}>
              <RotateCcwIcon /> Requeue
            </Button>
          )}
        </div>

        {c.reason && <p className="text-sm text-muted-foreground">Skipped: {c.reason}</p>}
        {c.blockers?.length ? <p className="text-sm text-muted-foreground">Blocked by {c.blockers.map((b) => `#${b}`).join(", ")}</p> : null}
        {c.testBuilds && <TestBuilds tb={c.testBuilds} />}

        {waiting && !isPr && <Reply n={c.number} repo={repo} pr={c.pr ?? null} onSent={load} />}

        {t === null ? (
          <Lines />
        ) : t === "error" ? (
          <p className="text-sm text-muted-foreground">Couldn't load it. Open it on GitHub instead.</p>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="rounded-xl border bg-card p-4">
              <div className="mb-2 text-xs text-muted-foreground">
                {thread!.pr ? "PR" : "Issue"} by <b className="font-medium text-foreground">{thread!.author}</b> · {time(thread!.created, timezone, { month: "short", day: "numeric" })} · {thread!.state}
              </div>
              {thread!.body.trim() ? <Markdown text={thread!.body} repo={repo} /> : <p className="text-sm text-muted-foreground">No description.</p>}
            </div>
            {thread!.comments.length > 0 && (
              <div className="flex flex-col gap-3">
                <div className="text-xs font-medium text-muted-foreground">
                  {thread!.comments.length} comment{thread!.comments.length === 1 ? "" : "s"}
                </div>
                {thread!.comments.map((cm, i) => (
                  <Comment key={i} c={cm} repo={repo} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </SheetContent>
  );
}

function Comment({ c, repo }: { c: Thread["comments"][number]; repo: string }) {
  const { head, rest } = split(c.body);
  const [open, setOpen] = React.useState(false);
  return (
    <div className={cn("rounded-xl border p-4", c.bot ? "bg-muted/40" : "bg-card")}>
      <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
        <span className={cn("grid size-5 place-items-center rounded-full", c.bot ? "bg-brand/15 text-brand" : "bg-secondary")}>{c.bot ? <BotIcon className="size-3" /> : <UserIcon className="size-3" />}</span>
        <b className="font-medium text-foreground">{c.bot ? "Agent" : c.author}</b>
        {c.kind !== "comment" && <span>{c.kind}</span>}
        <span title={new Date(c.at).toLocaleString()}>{rel(c.at)}</span>
      </div>
      {head ? <Markdown text={head} repo={repo} /> : <p className="text-sm text-muted-foreground">(no text)</p>}
      {rest && (
        <>
          {open && <Markdown text={rest} repo={repo} className="mt-3 border-t pt-3" />}
          <Button size="xs" variant="ghost" className="mt-2 -ml-2" onClick={() => setOpen(!open)}>
            {open ? "Hide details" : "Show details"}
          </Button>
        </>
      )}
    </div>
  );
}

/** The owner's reply box: posted as the app and counted as the owner's, so the PR's session resumes. */
export function Reply({ n, repo, pr, onSent, compact }: { n: number; repo: string; pr: number | null; onSent?: () => void; compact?: boolean }) {
  const key = `factory.answer.${repo}#${n}`;
  const [text, setText] = React.useState(() => {
    try {
      return localStorage.getItem(key) ?? "";
    } catch {
      return "";
    }
  });
  const [sending, setSending] = React.useState(false);
  const edit = (v: string) => {
    setText(v);
    try {
      if (v) localStorage.setItem(key, v);
      else localStorage.removeItem(key);
    } catch {
      // private mode: the draft just isn't kept
    }
  };
  const send = async () => {
    setSending(true);
    const ok = await control(`cards/${n}/answer`, { repo, text }, `Sent to #${n}`);
    setSending(false);
    if (ok) {
      edit("");
      onSent?.();
    }
  };
  return (
    <div className="flex flex-col gap-2">
      <Textarea
        rows={compact ? 3 : 4}
        placeholder="Your answer"
        aria-label={`Your answer to #${n}`}
        value={text}
        onChange={(e) => edit(e.target.value)}
        onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === "Enter" && text.trim() && send()}
      />
      <div className="flex items-center gap-3">
        <span className="flex-1 text-xs text-muted-foreground">{pr ? `PR #${pr} picks this up within a few minutes.` : "The maintainer queues it again at its next run."}</span>
        <Button size="sm" variant="brand" disabled={!text.trim() || sending} onClick={send}>
          <SendIcon /> {sending ? "Sending…" : "Send"}
        </Button>
      </div>
    </div>
  );
}
