// A few Magic UI / Aceternity-style accents, kept small and calm for a dashboard you leave open all day:
// a number that counts to its value, a light that runs round a live card's border, a pulsing status dot,
// shimmering text for "working", and a soft spotlight on cards under the pointer.
import * as React from "react";
import { animate, useInView, useMotionValue, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";

/** Counts up (or down) to `value` when it changes. */
export function NumberTicker({ value, format = (n) => String(Math.round(n)), className }: { value: number; format?: (n: number) => string; className?: string }) {
  const ref = React.useRef<HTMLSpanElement>(null);
  const mv = useMotionValue(value);
  const inView = useInView(ref, { once: true });
  const reduce = useReducedMotion();
  const first = React.useRef(true);
  React.useEffect(() => {
    if (!inView) return;
    const from = first.current ? 0 : mv.get();
    first.current = false;
    // A hidden page doesn't animate (no frames), so show the value straight away rather than a stale one.
    if (reduce || document.hidden) {
      mv.set(value);
      if (ref.current) ref.current.textContent = format(value);
      return;
    }
    mv.set(from);
    const c = animate(mv, value, { duration: 0.9, ease: [0.16, 1, 0.3, 1], onUpdate: (v) => ref.current && (ref.current.textContent = format(v)) });
    return () => c.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, inView]);
  return (
    <span ref={ref} className={cn("tabular-nums", className)}>
      {format(value)}
    </span>
  );
}

/** A light running round the parent's border (the parent needs `relative` and rounded corners). */
export function BorderBeam({ size = 90, duration = 6, from = "var(--brand)", to = "var(--ok)", className }: { size?: number; duration?: number; from?: string; to?: string; className?: string }) {
  return (
    <div className={cn("pointer-events-none absolute inset-0 rounded-[inherit] border border-transparent [mask-clip:padding-box,border-box] [mask-composite:intersect] [mask-image:linear-gradient(transparent,transparent),linear-gradient(#000,#000)] motion-reduce:hidden", className)}>
      <div
        className="absolute aspect-square animate-beam"
        style={
          {
            width: size,
            "--duration": duration,
            offsetPath: `rect(0 auto auto 0 round ${size}px)`,
            background: `linear-gradient(to left, ${from}, ${to}, transparent)`,
          } as React.CSSProperties
        }
      />
    </div>
  );
}

/** A status dot; `live` adds a soft ping. */
export function Dot({ tone = "muted", live, className }: { tone?: "ok" | "warn" | "bad" | "info" | "brand" | "muted"; live?: boolean; className?: string }) {
  const bg = { ok: "bg-ok", warn: "bg-warn", bad: "bg-bad", info: "bg-info", brand: "bg-brand", muted: "bg-muted-foreground/40" }[tone];
  return (
    <span className={cn("relative inline-flex size-2 shrink-0", className)}>
      {live && <span className={cn("absolute inline-flex size-full animate-ping-slow rounded-full opacity-60 motion-reduce:hidden", bg)} />}
      <span className={cn("relative inline-flex size-2 rounded-full", bg)} />
    </span>
  );
}

/** Text with a light sweeping across it (for "Working…"). */
export function Shimmer({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "animate-shimmer bg-[length:200%_100%] bg-clip-text text-transparent motion-reduce:animate-none motion-reduce:text-foreground",
        "bg-[linear-gradient(90deg,var(--muted-foreground)_0%,var(--muted-foreground)_35%,var(--foreground)_50%,var(--muted-foreground)_65%,var(--muted-foreground)_100%)]",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** A card that lights up softly under the pointer (Aceternity's spotlight, toned down). */
export function Spotlight({ className, children, ...p }: React.ComponentProps<"div">) {
  const ref = React.useRef<HTMLDivElement>(null);
  const move = (e: React.PointerEvent) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r || !ref.current) return;
    ref.current.style.setProperty("--x", `${e.clientX - r.left}px`);
    ref.current.style.setProperty("--y", `${e.clientY - r.top}px`);
  };
  return (
    <div
      ref={ref}
      onPointerMove={move}
      className={cn(
        "group/spot relative overflow-hidden rounded-xl border bg-card shadow-xs",
        "before:pointer-events-none before:absolute before:inset-0 before:opacity-0 before:transition-opacity before:duration-300 hover:before:opacity-100",
        "before:bg-[radial-gradient(420px_circle_at_var(--x)_var(--y),color-mix(in_oklch,var(--brand)_9%,transparent),transparent_60%)]",
        className,
      )}
      {...p}
    >
      {children}
    </div>
  );
}
