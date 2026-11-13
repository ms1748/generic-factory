// Lanes: every lane of every repo the factory serves (each from that repo's .factory.yml), as compact
// cards grouped by repo, then the runs scheduled for the next two days.
import { WaypointsIcon } from "lucide-react";
import type { State } from "@/lib/api";
import { PageHeader, Section, Empty, GitHubLink } from "@/components/patterns";
import { Timeline } from "@/components/charts";
import { LaneCard, modeOf } from "@/components/lanes/LaneCard";

export function LanesView({ d }: { d: State; tab: string; arg: string }) {
  const lanes: State[] = d.lanes ?? [];
  const groups: { repo: string; source: string; lanes: State[] }[] = [];
  for (const l of lanes) {
    const r = l.repo ?? d.repo;
    let g = groups.find((x) => x.repo === r);
    if (!g) groups.push((g = { repo: r, source: l.configSource ?? d.configSource, lanes: [] }));
    g.lanes.push(l);
  }
  const many = groups.length > 1;
  const live = lanes.filter((l) => modeOf(l) === "live").length;
  const dry = lanes.filter((l) => modeOf(l) === "dry").length;

  return (
    <>
      <PageHeader title="Lanes" description={lanes.length ? `${lanes.length} lanes · ${live} live · ${dry} dry` : undefined} />
      <div className="flex flex-col gap-6">
        {!lanes.length && <Empty icon={WaypointsIcon} title="No lanes">Add lanes to the repo's .factory.yml.</Empty>}
        {groups.map((g) => (
          <section key={g.repo} className="flex flex-col gap-3">
            {(many || g.source) && (
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                {many && <h2 className="text-sm font-semibold">{g.repo}</h2>}
                <span className="truncate text-xs text-muted-foreground">{g.source}</span>
                <GitHubLink href={`https://github.com/${g.repo}`} className="ml-auto">
                  Repo
                </GitHubLink>
              </div>
            )}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {g.lanes.map((l) => (
                <LaneCard key={l.name} d={d} l={l} repo={g.repo} label={many ? `${g.repo.split("/").pop()} ${l.name}` : l.name} />
              ))}
            </div>
          </section>
        ))}
        <Section title="Next two days" description={d.configSource}>
          <Timeline d={d} limit={24} />
        </Section>
      </div>
    </>
  );
}
