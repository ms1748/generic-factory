// Settings › Test builds: how long a closed PR's test builds stay up, and the closed PRs waiting for cleanup.
import * as React from "react";
import { control, type State } from "@/lib/api";
import { rel, time } from "@/lib/format";
import { IssueRef, Section, SettingRow } from "@/components/patterns";
import { Badge, Select } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { More, Note, Num, numVal } from "./bits";

const words = (h: number) => (h % 24 === 0 ? `${h / 24} day${h === 24 ? "" : "s"}` : `${h} hour${h === 1 ? "" : "s"}`);

export function BuildsTab({ d }: { d: State }) {
  const hours: number = d.settings?.testBuildDeleteHours ?? 24;
  const [unit, setUnit] = React.useState<"hours" | "days">("hours");
  const [amount, setAmount] = React.useState<number | "">(24);
  React.useEffect(() => {
    const u = hours % 24 === 0 ? "days" : "hours";
    setUnit(u);
    setAmount(u === "days" ? hours / 24 : hours);
  }, [hours]);
  const wanted = Math.round(Number(amount) * (unit === "days" ? 24 : 1));
  const c = d.testBuildCleanup;
  const tb = d.settings?.testBuilds ?? {};
  const step = (s: State) =>
    s.do === "wait" ? `deleted ${time(s.until, d.timezone)} (${rel(s.until)})` : s.do === "pending" ? `cleanup running since ${rel(s.since)}` : s.do === "dispatch" ? "cleanup due" : s.why;

  return (
    <div className="flex flex-col gap-4">
      <Section title="Test builds">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            control("settings/test-builds", { hours: wanted });
          }}
        >
          <SettingRow
            htmlFor="tb-amount"
            label={
              <>
                Delete test builds after
                <More>
                  Every version of a PR's test build stays up while it's open. Once it's merged or closed, the factory runs the project's {tb.cleanupWorkflow ?? "test-builds-cleanup.yml"}, which deletes them where they're hosted and on GitHub and marks the PR's comment
                  with the {tb.marker ?? "factory-test-builds"} marker. Both names come from the project's .factory.yml (test_builds:).
                </More>
              </>
            }
            hint={`Now ${words(hours)} after a PR closes. Checked hourly.`}
          >
            <Num id="tb-amount" min={1} step={1} required value={amount} onChange={(e) => setAmount(numVal(e))} />
            <Select aria-label="Unit" className="h-8" value={unit} onChange={(e) => setUnit(e.target.value as "hours" | "days")}>
              <option value="hours">hours</option>
              <option value="days">days</option>
            </Select>
            <Button type="submit" size="sm" variant="brand" disabled={wanted === hours || !(wanted >= 1)}>
              Save
            </Button>
          </SettingRow>
        </form>
      </Section>

      <Section title="Waiting for cleanup" description={c ? `Checked ${rel(c.checkedAt)}` : undefined} flush>
        {c?.problem && <Note className="m-4 mb-0">Can't clean up: {c.problem}.</Note>}
        {!c ? (
          <p className="p-4 text-sm text-muted-foreground">The first check runs shortly after the dispatcher starts.</p>
        ) : c.prs.length ? (
          <ul className="divide-y">
            {c.prs.map((p: State) => (
              <li key={p.pr} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
                <IssueRef repo={d.repo} n={p.pr} pr />
                <span className="min-w-0 flex-1 truncate text-sm">{p.title}</span>
                <Badge variant={p.merged ? "ok" : "outline"}>
                  {p.merged ? "merged" : "closed"} {rel(p.closedAt)}
                </Badge>
                <span className="w-full text-xs text-muted-foreground sm:w-auto">{step(p.step)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="p-4 text-sm text-muted-foreground">No closed PR has test builds waiting to be deleted.</p>
        )}
      </Section>
    </div>
  );
}
