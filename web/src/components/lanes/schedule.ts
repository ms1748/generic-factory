// A lane's schedule (.factory.yml `schedule:` entries like "09:30" or "mon,thu 21:00"): the times it runs
// today as minutes of the day, and a short summary of the whole list.

const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

type Slot = { days: number[] | null; min: number };

export function parse(schedule: string[]): Slot[] {
  return (schedule ?? [])
    .map((e) => e.trim().toLowerCase().match(/^(?:([a-z,]+)\s+)?(\d{1,2}):(\d{2})$/))
    .filter((m): m is RegExpMatchArray => !!m)
    .map((m) => ({ days: m[1] ? m[1].split(",").map((x) => DAYS.indexOf(x.slice(0, 3))) : null, min: Number(m[2]) * 60 + Number(m[3]) }));
}

export function summary(schedule: string[]): string {
  const s = parse(schedule);
  if (!s.length) return "On demand";
  const every = s.every((x) => !x.days) && s.length >= 12;
  if (every && s.length === 24) {
    const mm = String(s[0].min % 60).padStart(2, "0");
    return s.every((x) => x.min % 60 === s[0].min % 60) ? `Hourly at :${mm}` : "24 times a day";
  }
  if (every) return `${s.length} times a day`;
  return schedule.join(", ");
}

/** Now in a time zone: the minute of the day and the weekday. */
export function zonedNow(nowIso: string, tz: string): { min: number; day: number } {
  const z = new Date(new Date(nowIso).toLocaleString("en-US", { timeZone: tz }));
  return { min: z.getHours() * 60 + z.getMinutes(), day: z.getDay() };
}

/** Today's run times, in minutes of the day. */
export const ticks = (schedule: string[], day: number) =>
  parse(schedule)
    .filter((x) => !x.days || x.days.includes(day))
    .map((x) => x.min);
