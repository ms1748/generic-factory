// The small building blocks: card, badge, inputs, switch, tabs, tooltip, separator, skeleton, progress.
import * as React from "react";
import { Switch as SwitchP, Tabs as TabsP, Tooltip as TooltipP, Separator as SeparatorP, Progress as ProgressP } from "radix-ui";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/* Card */
export function Card({ className, ...p }: React.ComponentProps<"div">) {
  return <div data-slot="card" className={cn("rounded-xl border bg-card text-card-foreground shadow-xs", className)} {...p} />;
}
export function CardHeader({ className, ...p }: React.ComponentProps<"div">) {
  return <div className={cn("flex items-center gap-2 border-b px-4 py-3 min-h-12", className)} {...p} />;
}
export function CardTitle({ className, ...p }: React.ComponentProps<"h2">) {
  return <h2 className={cn("text-sm font-semibold tracking-tight", className)} {...p} />;
}
export function CardDescription({ className, ...p }: React.ComponentProps<"p">) {
  return <p className={cn("text-xs text-muted-foreground", className)} {...p} />;
}
export function CardContent({ className, ...p }: React.ComponentProps<"div">) {
  return <div className={cn("p-4", className)} {...p} />;
}

/* Badge */
const badgeVariants = cva("inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[11px] font-medium leading-none [&_svg]:size-3", {
  variants: {
    variant: {
      default: "border-transparent bg-secondary text-secondary-foreground",
      outline: "text-muted-foreground",
      ok: "border-ok/25 bg-ok/10 text-ok",
      warn: "border-warn/25 bg-warn/10 text-warn",
      bad: "border-bad/25 bg-bad/10 text-bad",
      info: "border-info/25 bg-info/10 text-info",
      brand: "border-brand/25 bg-brand/10 text-brand",
    },
  },
  defaultVariants: { variant: "default" },
});
export type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>["variant"]>;
export function Badge({ className, variant, ...p }: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...p} />;
}

/* Inputs */
const field =
  "h-9 w-full min-w-0 rounded-md border border-input bg-background/40 px-3 text-sm shadow-xs outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:opacity-50";
export function Input({ className, ...p }: React.ComponentProps<"input">) {
  return <input className={cn(field, p.type === "number" && "w-20 tabular-nums", className)} {...p} />;
}
export function Textarea({ className, ...p }: React.ComponentProps<"textarea">) {
  return <textarea className={cn(field, "h-auto min-h-24 py-2 leading-relaxed", className)} {...p} />;
}
/** A native select (best on phones), styled like the inputs. */
export function Select({ className, ...p }: React.ComponentProps<"select">) {
  return <select className={cn(field, "w-auto cursor-pointer pr-8", className)} {...p} />;
}

/* Switch */
export function Switch({ className, ...p }: React.ComponentProps<typeof SwitchP.Root>) {
  return (
    <SwitchP.Root
      className={cn(
        "peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-transparent shadow-xs transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-brand data-[state=unchecked]:bg-input",
        className,
      )}
      {...p}
    >
      <SwitchP.Thumb className="pointer-events-none block size-4 rounded-full bg-white shadow ring-0 transition-transform data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0.5" />
    </SwitchP.Root>
  );
}

/* Tabs */
export const Tabs = TabsP.Root;
export function TabsList({ className, ...p }: React.ComponentProps<typeof TabsP.List>) {
  return <TabsP.List className={cn("inline-flex h-9 items-center gap-0.5 rounded-lg bg-muted p-1 text-muted-foreground max-w-full overflow-x-auto", className)} {...p} />;
}
export function TabsTrigger({ className, ...p }: React.ComponentProps<typeof TabsP.Trigger>) {
  return (
    <TabsP.Trigger
      className={cn(
        "inline-flex h-7 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 text-[13px] font-medium transition-all outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm [&_svg]:size-3.5",
        className,
      )}
      {...p}
    />
  );
}
export const TabsContent = TabsP.Content;

/* Tooltip */
export function Tip({ content, children, side = "top" }: { content: React.ReactNode; children: React.ReactNode; side?: "top" | "bottom" | "left" | "right" }) {
  if (!content) return <>{children}</>;
  return (
    <TooltipP.Root delayDuration={250}>
      <TooltipP.Trigger asChild>{children}</TooltipP.Trigger>
      <TooltipP.Portal>
        <TooltipP.Content side={side} sideOffset={6} className="z-50 max-w-72 rounded-md bg-primary px-2.5 py-1.5 text-xs text-primary-foreground shadow-md animate-in fade-in-0">
          {content}
        </TooltipP.Content>
      </TooltipP.Portal>
    </TooltipP.Root>
  );
}
export const TooltipProvider = TooltipP.Provider;

/* Separator, skeleton, progress, kbd */
export function Separator({ className, orientation = "horizontal", ...p }: React.ComponentProps<typeof SeparatorP.Root>) {
  return <SeparatorP.Root orientation={orientation} className={cn("shrink-0 bg-border", orientation === "horizontal" ? "h-px w-full" : "h-full w-px", className)} {...p} />;
}
export function Skeleton({ className, ...p }: React.ComponentProps<"div">) {
  return <div className={cn("animate-pulse rounded-md bg-muted", className)} {...p} />;
}
export function Progress({ value, className, tone = "brand" }: { value: number; className?: string; tone?: "brand" | "ok" | "warn" | "bad" }) {
  const bg = { brand: "bg-brand", ok: "bg-ok", warn: "bg-warn", bad: "bg-bad" }[tone];
  return (
    <ProgressP.Root value={value} className={cn("relative h-1.5 w-full overflow-hidden rounded-full bg-muted", className)}>
      <ProgressP.Indicator className={cn("h-full transition-[width] duration-500", bg)} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </ProgressP.Root>
  );
}
export function Kbd({ className, ...p }: React.ComponentProps<"kbd">) {
  return <kbd className={cn("pointer-events-none inline-flex h-5 select-none items-center gap-0.5 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground", className)} {...p} />;
}
