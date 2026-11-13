// Page-level patterns every view uses, so they all look and read the same: the page header, a section,
// a compact setting row (label and one-line hint left, control right), an empty state, a stat tile,
// a link to an issue or PR, and Markdown from GitHub.
import * as React from "react";
import { ExternalLinkIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { gh, short } from "@/lib/format";
import { md } from "@/lib/md";
import { Card } from "./ui/primitives";
import { NumberTicker } from "./magic";

export function PageHeader({ title, description, actions, children }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold tracking-tight md:text-2xl">{title}</h1>
          {description && <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

/** A titled group of content on a card. `flush` drops the body padding (for lists). */
export function Section({ title, description, actions, children, className, flush, id }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string; flush?: boolean; id?: string }) {
  return (
    <Card className={cn("overflow-hidden", className)} id={id}>
      <div className="flex min-h-12 flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-2.5">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
      <div className={flush ? "" : "p-4"}>{children}</div>
    </Card>
  );
}

/** One setting on one line: what it is (and a short hint) on the left, its control on the right. */
export function SettingRow({ label, hint, children, className, htmlFor }: { label: React.ReactNode; hint?: React.ReactNode; children: React.ReactNode; className?: string; htmlFor?: string }) {
  return (
    <div className={cn("flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:gap-6", className)}>
      <div className="min-w-0 flex-1">
        <label htmlFor={htmlFor} className="text-sm font-medium">
          {label}
        </label>
        {hint && <div className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{hint}</div>}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}
/** Setting rows with dividers between them. */
export function SettingList({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("divide-y", className)}>{children}</div>;
}

export function Empty({ icon: Icon, title, children, className }: { icon?: React.ComponentType<{ className?: string }>; title: React.ReactNode; children?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-6 py-10 text-center", className)}>
      {Icon && (
        <div className="mb-1 grid size-10 place-items-center rounded-full bg-muted">
          <Icon className="size-5 text-muted-foreground" />
        </div>
      )}
      <div className="text-sm font-medium">{title}</div>
      {children && <div className="max-w-sm text-xs text-muted-foreground">{children}</div>}
    </div>
  );
}

/** A number with a label: the tiles on Home and the summary rows. */
export function Stat({ label, value, format, suffix, hint, tone, icon: Icon, onClick, className }: { label: React.ReactNode; value: number | null | undefined; format?: (n: number) => string; suffix?: React.ReactNode; hint?: React.ReactNode; tone?: "ok" | "warn" | "bad" | "brand"; icon?: React.ComponentType<{ className?: string }>; onClick?: () => void; className?: string }) {
  const color = tone ? { ok: "text-ok", warn: "text-warn", bad: "text-bad", brand: "text-brand" }[tone] : "";
  const Comp = onClick ? "button" : "div";
  return (
    <Comp onClick={onClick} className={cn("group relative flex flex-col gap-1 rounded-xl border bg-card p-4 text-left shadow-xs transition", onClick && "cursor-pointer hover:border-foreground/15 hover:bg-accent/40", className)}>
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {Icon && <Icon className="size-3.5" />}
        {label}
      </div>
      <div className={cn("text-2xl font-semibold tracking-tight", color)}>
        {value == null ? "–" : <NumberTicker value={value} format={format} />}
        {suffix && <span className="ml-1 text-sm font-normal text-muted-foreground">{suffix}</span>}
      </div>
      {hint && <div className="truncate text-xs text-muted-foreground">{hint}</div>}
    </Comp>
  );
}

/** "#12" (or "app#12" for another repo) linking to GitHub. */
export function IssueRef({ repo, primary, n, pr, className }: { repo: string; primary?: string; n: number; pr?: boolean; className?: string }) {
  return (
    <a href={gh(repo, pr ? "pull" : "issues", n)} target="_blank" rel="noopener" onClick={(e) => e.stopPropagation()} className={cn("font-mono text-xs text-muted-foreground tabular-nums hover:text-brand hover:underline", className)}>
      {primary && repo !== primary ? short(repo) : ""}#{n}
    </a>
  );
}

export function GitHubLink({ href, children = "Open on GitHub", className }: { href: string; children?: React.ReactNode; className?: string }) {
  return (
    <a href={href} target="_blank" rel="noopener" onClick={(e) => e.stopPropagation()} className={cn("inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline", className)}>
      {children}
      <ExternalLinkIcon className="size-3" />
    </a>
  );
}

/** Markdown from GitHub, rendered safely (lib/md.ts escapes everything first). */
export function Markdown({ text, repo, className }: { text: string; repo: string; className?: string }) {
  const html = React.useMemo(() => md(text ?? "", repo), [text, repo]);
  return <div className={cn("prose-gh", className)} dangerouslySetInnerHTML={{ __html: html }} />;
}

/** Segmented control for small option sets (range pickers, filters). */
export function Segmented<T extends string>({ value, options, onChange, className }: { value: T; options: { value: T; label: React.ReactNode }[]; onChange: (v: T) => void; className?: string }) {
  return (
    <div className={cn("inline-flex h-8 items-center gap-0.5 rounded-lg bg-muted p-0.5", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={cn("h-7 rounded-md px-2.5 text-xs font-medium text-muted-foreground transition hover:text-foreground", value === o.value && "bg-background text-foreground shadow-sm")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
