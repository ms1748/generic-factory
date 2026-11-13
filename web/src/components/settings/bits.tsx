// Small pieces the Settings tabs share: an info icon with the longer explanation, a number input with its
// unit, a switch that flips at once and saves, a number that saves when you leave it, a form copy of saved
// settings, and a Save/Undo footer.
import * as React from "react";
import { InfoIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input, Switch, Tip } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";

/** The longer explanation of a setting, behind an info icon. */
export function More({ children }: { children: React.ReactNode }) {
  return (
    <Tip content={children}>
      <button type="button" aria-label="More about this" className="ml-1 inline-grid size-4 translate-y-0.5 place-items-center rounded-full text-muted-foreground/70 hover:text-foreground focus-visible:text-foreground focus-visible:outline-none">
        <InfoIcon className="size-3.5" />
      </button>
    </Tip>
  );
}

/** The value of a number input: "" while it's empty, so it can be typed over. */
export const numVal = (e: React.ChangeEvent<HTMLInputElement>): number | "" => (e.target.value === "" ? "" : e.target.valueAsNumber);

/** A number input with its unit after it ("90 %", "10 min"). */
export function Num({ unit, className, ...p }: React.ComponentProps<"input"> & { unit?: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
      <Input type="number" inputMode="numeric" className={cn("h-8 w-16", className)} {...p} />
      {unit}
    </span>
  );
}

/** A switch that shows its new position at once and saves it; flips back if saving fails. */
export function LiveSwitch({ checked, onSave, id, label, disabled }: { checked: boolean; onSave: (on: boolean) => Promise<boolean>; id?: string; label?: string; disabled?: boolean }) {
  const [v, setV] = React.useState<boolean | null>(null);
  React.useEffect(() => setV(null), [checked]);
  return (
    <Switch
      id={id}
      aria-label={label}
      disabled={disabled}
      checked={v ?? checked}
      onCheckedChange={async (on) => {
        setV(on);
        if (!(await onSave(on))) setV(null);
      }}
    />
  );
}

/** A number that saves when you leave the field (or press Enter), if it changed. */
export function CommitNum({ value, onCommit, ...p }: Omit<React.ComponentProps<typeof Num>, "value" | "onChange"> & { value: number; onCommit: (n: number) => void }) {
  const [v, setV] = React.useState<number | "">(value);
  React.useEffect(() => setV(value), [value]);
  const commit = () => {
    if (v === "" || !Number.isFinite(v)) return setV(value);
    if (v !== value) onCommit(v);
  };
  return <Num value={v} onChange={(e) => setV(numVal(e))} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && (e.currentTarget.blur(), e.preventDefault())} {...p} />;
}

/**
 * A form copy of saved settings, refreshed from the server until it's changed here. `edit` marks it
 * changed; `quiet` updates it without (a switch that already saved itself); `undo` goes back to the saved one.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useDraft<T = any>(source: unknown, toForm: (s: any) => T) {
  const [form, setForm] = React.useState<T | null>(null);
  const [dirty, setDirty] = React.useState(false);
  const key = JSON.stringify(source ?? null);
  React.useEffect(() => {
    if (source != null && !dirty) setForm(toForm(source));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, dirty]);
  const edit = (f: (x: T) => T) => {
    setForm((x) => (x == null ? x : f(x)));
    setDirty(true);
  };
  const quiet = (f: (x: T) => T) => setForm((x) => (x == null ? x : f(x)));
  const undo = () => {
    setDirty(false);
    if (source != null) setForm(toForm(source));
  };
  return { form, dirty, edit, quiet, undo, setDirty };
}

/** Save (disabled until something changed) and Undo, at the foot of a form. */
export function SaveBar({ dirty, onUndo, children, className, label = "Save" }: { dirty: boolean; onUndo: () => void; children?: React.ReactNode; className?: string; label?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-2 border-t pt-3", className)}>
      <Button type="submit" size="sm" variant="brand" disabled={!dirty}>
        {label}
      </Button>
      {dirty && (
        <Button type="button" size="sm" variant="ghost" onClick={onUndo}>
          Undo
        </Button>
      )}
      {children}
    </div>
  );
}

/** A plain-language problem box. */
export function Note({ tone = "bad", children, className }: { tone?: "bad" | "warn"; children: React.ReactNode; className?: string }) {
  return <div className={cn("rounded-lg border px-3 py-2 text-xs", tone === "bad" ? "border-bad/25 bg-bad/10 text-bad" : "border-warn/25 bg-warn/10 text-warn", className)}>{children}</div>;
}
