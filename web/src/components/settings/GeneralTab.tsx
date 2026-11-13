// Settings › General: how many runs at once, auto-merge, screenshots, auto-queue and paid credits.
import { control, type State } from "@/lib/api";
import { rel, short } from "@/lib/format";
import { Section, SettingList, SettingRow } from "@/components/patterns";
import { Select } from "@/components/ui/primitives";
import { CommitNum, LiveSwitch, More } from "./bits";

export function GeneralTab({ d }: { d: State }) {
  const s = d.settings ?? {};
  const runs: number = s.parallelRuns ?? 1;
  const max: number = s.maxParallelRuns ?? 3;
  const aq = s.autoQueue ?? {};
  const last: State[] = aq.last ?? [];
  const lastLine = last
    .map((l) => `${short(l.repo)} ${rel(l.at)}: ${l.added?.length ? l.added.map((n: number) => "#" + n).join(" ") : l.note}`)
    .join(" · ");

  return (
    <Section title="Runs">
      <SettingList>
        <SettingRow
          htmlFor="set-parallel"
          label={
            <>
              Parallel runs
              <More>Each run gets its own container on its own card or PR. They share the plan's usage and split 5 CPUs and 8 GB, so each is a little slower.</More>
            </>
          }
          hint={runs === 1 ? "One at a time: builds, resumes and reviews wait for each other." : `Up to ${runs} runs at once.`}
        >
          <Select id="set-parallel" className="h-8" value={String(runs)} onChange={(e) => control("settings/parallel", { runs: Number(e.target.value) })}>
            {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
              <option key={n} value={String(n)}>
                {n === 1 ? "1 (one at a time)" : `${n} at once`}
              </option>
            ))}
          </Select>
        </SettingRow>

        <SettingRow
          htmlFor="set-automerge"
          label={
            <>
              Auto-merge
              <More>Factory PRs merge once the reviewer passes them and CI and the device tests are green. Workflows, signing, the updater, secrets, the app's permissions, risky paths and anything the reviewer flags still wait for you.</More>
            </>
          }
          hint={(s.autoMerge ?? true) ? "Passed, green factory PRs merge by themselves." : "Off: factory PRs wait for you to merge them."}
        >
          <LiveSwitch id="set-automerge" checked={s.autoMerge ?? true} onSave={(on) => control("settings/automerge", { on })} />
        </SettingRow>

        <SettingRow
          htmlFor="set-shots"
          label={
            <>
              Before/after screenshots
              <More>When the reviewer hands you a website PR, a script (no Claude usage, under a minute) shoots the changed pages on the live site and the PR's preview, at desktop and phone width, and posts them side by side on the PR. The images live on a "Factory screenshots" pre-release in the project's repo.</More>
            </>
          }
          hint={s.shots ? "Website PRs get live vs preview shots, desktop and phone." : "Off: website PRs get no screenshots."}
        >
          <LiveSwitch id="set-shots" checked={s.shots ?? false} onSave={(on) => control("settings/shots", { on })} />
        </SettingRow>

        <SettingRow
          htmlFor="set-autoqueue"
          label={
            <>
              Auto-queue ideas
              <More>
                When too few cards are ready to build, a short Sonnet run (at most every few hours, see Limits) queues ideas an agent can do alone, with a comment saying why. Hardware checks, releases, billing, hold, needs-owner, p3 and someday ideas stay with you.
              </More>
            </>
          }
          hint={aq.on ? (lastLine ? `Last: ${lastLine}` : "Tops up the ready column from ideas.") : "Off: ideas wait for you to queue them."}
        >
          {aq.on && (
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
              Below
              <CommitNum aria-label="Ready cards threshold" min={1} max={20} value={aq.threshold ?? 1} onCommit={(n) => control("settings/autoqueue", { threshold: n })} unit="ready, up to" />
              <CommitNum aria-label="Most ideas to queue" min={1} max={10} value={aq.max ?? 1} onCommit={(n) => control("settings/autoqueue", { max: n })} unit="ideas" />
            </span>
          )}
          <LiveSwitch id="set-autoqueue" checked={aq.on ?? false} onSave={(on) => control("settings/autoqueue", { on })} />
        </SettingRow>

        <SettingRow
          htmlFor="set-credits"
          label="Use paid credits"
          hint={d.allowCredits ? "Runs keep going on extra-usage credits when the plan runs out." : "Off: runs stop when the plan runs out."}
        >
          <LiveSwitch id="set-credits" checked={!!d.allowCredits} onSave={(on) => control("settings/credits", { on })} />
        </SettingRow>
      </SettingList>
    </Section>
  );
}
