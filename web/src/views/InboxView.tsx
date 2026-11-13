// Everything waiting on the owner, sorted by what it needs: questions to answer (with a reply box right
// there), cards waiting on a step or a check, and PRs the reviewer handed over. Every row opens the full
// card or PR. #/inbox/12 (or #/inbox/owner/repo/12) puts that card first: a notification's link.
import * as React from "react";
import { MessageCircleQuestionIcon, ClipboardCheckIcon, GitPullRequestIcon, CheckCircle2Icon, ChevronRightIcon, ExternalLinkIcon, InboxIcon } from "lucide-react";
import { getJson, type State } from "@/lib/api";
import { openItem } from "@/lib/overlays";
import { gh, rel, short } from "@/lib/format";
import { isQuestion, latestAgent, split, why, type Thread } from "@/lib/questions";
import { cn } from "@/lib/utils";
import { PageHeader, Empty, Markdown } from "@/components/patterns";
import { Reply } from "@/components/DetailSheet";
import { Badge, Card, Skeleton } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { Dot, Shimmer, BorderBeam } from "@/components/magic";

type Card = { number: number; title: string; repo: string; pr: number | null; labels: string[]; priority?: string | null; size?: string | null };

/** Each waiting card's thread, fetched once per visit (the server caches them a minute). */
function useThreads(cards: Card[], primary: string) {
  const [threads, setThreads] = React.useState<Record<string, Thread | "error">>({});
  const keys = cards.map((c) => `${c.repo}#${c.number}`).join(",");
  React.useEffect(() => {
    let stop = false;
    for (const c of cards) {
      const k = `${c.repo}#${c.number}`;
      if (threads[k]) continue;
      getJson<Thread>(`/api/issues/${c.number}${c.repo !== primary ? `?repo=${encodeURIComponent(c.repo)}` : ""}`).then((t) => !stop && setThreads((m) => ({ ...m, [k]: t ?? "error" })));
    }
    return () => {
      stop = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys]);
  return threads;
}

export function InboxView({ d, arg }: { d: State; arg: string }) {
  const primary: string = d.repo;
  const cards: Card[] = d.board.needsYou.map((c: State) => ({ ...c, repo: c.repo ?? primary }));
  const threads = useThreads(cards, primary);
  const target = React.useMemo(() => {
    const parts = arg.split("/").filter(Boolean);
    const n = Number(parts.at(-1));
    return Number.isInteger(n) && n > 0 ? `${parts.length >= 3 ? parts.slice(0, -1).join("/") : primary}#${n}` : "";
  }, [arg, primary]);
  const key = (c: Card) => `${c.repo}#${c.number}`;
  const first = (a: Card, b: Card) => Number(key(b) === target) - Number(key(a) === target);

  const questions = cards.filter((c) => {
    const t = threads[key(c)];
    return t && t !== "error" && isQuestion(latestAgent(t)?.body ?? "");
  });
  const loading = cards.filter((c) => !threads[key(c)]);
  const steps = cards.filter((c) => threads[key(c)] && !questions.includes(c));
  const prs: State[] = (d.board.review ?? []).filter((p: State) => p.factory && p.verdict === "ready").map((p: State) => ({ ...p, repo: p.repo ?? primary }));
  const answered: State[] = d.board.next.filter((c: State) => c.answered);
  const working = (c: State) => (d.runningAll ?? []).some((r: State) => r.card === c.number && (r.repo ?? primary) === (c.repo ?? primary));
  const total = cards.length + prs.length;

  return (
    <>
      <PageHeader
        title="Inbox"
        description={total ? `${total} thing${total === 1 ? "" : "s"} waiting on you. Answer a question right here, or open any row for the whole card.` : "Nothing waits on you right now."}
      />
      <div className="mx-auto flex max-w-3xl flex-col gap-8">
        {total === 0 && (
          <Empty icon={InboxIcon} title="You're all caught up">
            Agents ask here when they need a decision, and PRs the reviewer passes show up for you to merge.
          </Empty>
        )}

        {(questions.length > 0 || loading.length > 0) && (
          <Group icon={MessageCircleQuestionIcon} title="Questions for you" count={questions.length} hint="An agent stopped to ask. Your reply resumes its session.">
            {[...questions].sort(first).map((c) => (
              <QuestionCard key={key(c)} c={c} t={threads[key(c)] as Thread} primary={primary} target={key(c) === target} />
            ))}
            {loading.map((c) => (
              <Card key={key(c)} className="p-4">
                <Skeleton className="mb-3 h-4 w-1/2" />
                <Skeleton className="h-3 w-5/6" />
              </Card>
            ))}
          </Group>
        )}

        {steps.length > 0 && (
          <Group icon={ClipboardCheckIcon} title="Waiting on a step from you" count={steps.length} hint="No question here: a check on real hardware, a setting only you can change, or a call on whether it's done.">
            <Card className="divide-y overflow-hidden">
              {[...steps].sort(first).map((c) => (
                <StepRow key={key(c)} c={c} t={threads[key(c)]} primary={primary} target={key(c) === target} />
              ))}
            </Card>
          </Group>
        )}

        {prs.length > 0 && (
          <Group icon={GitPullRequestIcon} title="Ready for you to merge" count={prs.length} hint="The reviewer passed these, but auto-merge left them for you (workflows, signing, permissions, or something it flagged).">
            <Card className="divide-y overflow-hidden">
              {prs.map((p) => (
                <Row key={`${p.repo}#${p.number}`} onClick={() => openItem({ ...p, column: "review", isPr: true })}>
                  <GitPullRequestIcon className="size-4 shrink-0 text-ok" />
                  <Ref repo={p.repo} primary={primary} n={p.number} pr />
                  <span className="min-w-0 flex-1 truncate text-sm">{p.title}</span>
                  {p.updatedAt && <span className="hidden text-xs text-muted-foreground sm:inline">{rel(p.updatedAt)}</span>}
                  <Button asChild size="xs" variant="outline" onClick={(e) => e.stopPropagation()}>
                    <a href={gh(p.repo, "pull", p.number)} target="_blank" rel="noopener">
                      Review <ExternalLinkIcon />
                    </a>
                  </Button>
                </Row>
              ))}
            </Card>
          </Group>
        )}

        {answered.length > 0 && (
          <Group icon={CheckCircle2Icon} title="Answered" count={answered.length} hint="Back with the agents.">
            <Card className="divide-y overflow-hidden">
              {answered.map((c) => (
                <Row key={`${c.repo}#${c.number}`} onClick={() => openItem({ ...c, column: "next" })}>
                  <Ref repo={c.repo ?? primary} primary={primary} n={c.number} />
                  <span className="min-w-0 flex-1 truncate text-sm">{c.title}</span>
                  {working(c) ? (
                    <Badge variant="ok">
                      <Dot tone="ok" live /> <Shimmer>Agent working</Shimmer>
                    </Badge>
                  ) : (
                    <Badge variant="outline">Waiting for the agent</Badge>
                  )}
                </Row>
              ))}
            </Card>
          </Group>
        )}
      </div>
    </>
  );
}

function Group({ icon: Icon, title, count, hint, children }: { icon: React.ComponentType<{ className?: string }>; title: string; count: number; hint: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Icon className="size-4 text-muted-foreground" /> {title}
          <span className="rounded-full bg-muted px-2 text-xs font-medium tabular-nums text-muted-foreground">{count}</span>
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
      </div>
      {children}
    </section>
  );
}

function Ref({ repo, primary, n, pr }: { repo: string; primary: string; n: number; pr?: boolean }) {
  return (
    <a href={gh(repo, pr ? "pull" : "issues", n)} target="_blank" rel="noopener" onClick={(e) => e.stopPropagation()} className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums hover:text-brand hover:underline">
      {repo !== primary ? short(repo) : ""}#{n}
    </a>
  );
}

function Row({ children, onClick, className }: { children: React.ReactNode; onClick: () => void; className?: string }) {
  return (
    <div role="button" tabIndex={0} onClick={onClick} onKeyDown={(e) => e.key === "Enter" && onClick()} className={cn("group flex cursor-pointer items-center gap-3 px-4 py-3 transition hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:outline-none", className)}>
      {children}
      <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground/50 transition group-hover:translate-x-0.5 group-hover:text-muted-foreground" />
    </div>
  );
}

function QuestionCard({ c, t, primary, target }: { c: Card; t: Thread; primary: string; target: boolean }) {
  const q = latestAgent(t)!;
  const { head, rest } = split(q.body);
  const [more, setMore] = React.useState(false);
  const open = () => openItem({ ...c, column: "needsYou" });
  return (
    <Card className={cn("relative overflow-hidden", target && "ring-2 ring-brand/50")}>
      {target && <BorderBeam />}
      <button onClick={open} className="group flex w-full items-start gap-3 border-b px-4 py-3 text-left transition hover:bg-accent/40">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Ref repo={c.repo} primary={primary} n={c.number} />
            {c.pr && <Badge variant="outline">PR #{c.pr}</Badge>}
            <span className="text-xs text-muted-foreground">asked {rel(q.at)}</span>
          </div>
          <div className="mt-1 text-sm font-medium leading-snug group-hover:text-brand">{c.title}</div>
        </div>
        <ChevronRightIcon className="mt-1 size-4 shrink-0 text-muted-foreground/60" />
      </button>
      <div className="flex flex-col gap-3 p-4">
        <div className={cn("relative", !more && "max-h-56 overflow-hidden")}>
          <Markdown text={head.replace(/^🤖\s*/u, "")} repo={c.repo} />
          {more && rest && <Markdown text={rest} repo={c.repo} className="mt-3 border-t pt-3" />}
          {!more && <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-card" />}
        </div>
        <Button size="xs" variant="ghost" className="-mt-1 self-start" onClick={() => setMore(!more)}>
          {more ? "Show less" : "Read all of it"}
        </Button>
        <Reply n={c.number} repo={c.repo} pr={c.pr} compact />
      </div>
    </Card>
  );
}

function StepRow({ c, t, primary, target }: { c: Card; t: Thread | "error" | undefined; primary: string; target: boolean }) {
  const thread = t && t !== "error" ? t : null;
  return (
    <Row onClick={() => openItem({ ...c, column: "needsYou" })} className={cn("items-start", target && "bg-brand/5")}>
      <Dot tone="warn" className="mt-1.5" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Ref repo={c.repo} primary={primary} n={c.number} />
          <span className="truncate text-sm font-medium">{c.title}</span>
        </div>
        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{thread ? why(thread) || "Labelled needs-owner." : "Couldn't load the card."}</p>
      </div>
    </Row>
  );
}
