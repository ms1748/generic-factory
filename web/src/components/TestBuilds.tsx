// A PR's numbered test builds (newest first): the hosted build and the 7-day GitHub artifact. Once the cleanup
// workflow has run they're listed as deleted, without links.
import { PackageIcon } from "lucide-react";
import { rel } from "@/lib/format";
import { Badge } from "./ui/primitives";
import type { State } from "@/lib/api";

const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return "Build";
  }
};

export function TestBuilds({ tb, className }: { tb: State; className?: string }) {
  if (!tb?.versions?.length) return null;
  return (
    <details className={"group rounded-lg border bg-muted/30 text-xs " + (className ?? "")} open={tb.versions.length <= 3} onClick={(e) => e.stopPropagation()}>
      <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-2 font-medium text-muted-foreground hover:text-foreground">
        <PackageIcon className="size-3.5" /> Test builds <span className="tabular-nums">{tb.versions.length}</span>
        {tb.deleted && <Badge variant="outline">deleted</Badge>}
      </summary>
      <ul className="max-h-40 space-y-1 overflow-y-auto px-3 pb-2">
        {tb.versions.map((x: State) => (
          <li key={x.v} className="flex flex-wrap items-baseline gap-x-2">
            <b className={"font-mono " + (tb.deleted ? "text-muted-foreground line-through" : "")}>v{x.v}</b>
            <span className="text-muted-foreground" title={new Date(x.at).toLocaleString()}>
              {x.sha ? x.sha + " · " : ""}
              {rel(x.at)}
            </span>
            {tb.deleted ? (
              <span className="text-muted-foreground">deleted</span>
            ) : (
              <>
                {x.site && (
                  <a className="text-brand hover:underline" href={x.site} target="_blank" rel="noopener">
                    {hostOf(x.site)}
                  </a>
                )}
                {x.artifact ? (
                  <a className="text-brand hover:underline" href={x.artifact} target="_blank" rel="noopener" title={`Expires ${new Date(x.artifactExpires).toLocaleString()}`}>
                    GitHub
                  </a>
                ) : (
                  <span className="text-muted-foreground" title="GitHub keeps artifacts for 7 days">
                    GitHub expired
                  </span>
                )}
              </>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}
