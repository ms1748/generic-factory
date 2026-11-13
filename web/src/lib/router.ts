// The current page from the URL hash (#/work/board, #/runs/run/42, #/inbox/owner/repo/12), so pages can be
// bookmarked and the back button works. Old hashes from the previous dashboard (#/answer, #/devices) still land.
import { useSyncExternalStore } from "react";

export type Route = { view: string; tab: string; arg: string };

export const VIEWS = ["home", "inbox", "work", "runs", "lanes", "machines", "insights", "links", "settings"] as const;

/** Old view names and where they live now (view, tab). */
const OLD: Record<string, [string, string]> = {
  overview: ["home", ""],
  answer: ["inbox", ""],
  board: ["work", "board"],
  ideas: ["work", "ideas"],
  activity: ["runs", "activity"],
  logs: ["runs", "logs"],
  devices: ["machines", "devices"],
  systems: ["machines", "systems"],
  perf: ["machines", "performance"],
  data: ["insights", "data"],
  reports: ["insights", "reports"],
};

function parse(): Route {
  const [first = "", ...rest] = location.hash.replace(/^#\/?/, "").split("/").filter((x, i) => i === 0 || x);
  if (OLD[first]) {
    const [view, tab] = OLD[first];
    return { view, tab, arg: rest.join("/") };
  }
  const view = (VIEWS as readonly string[]).includes(first) ? first : "home";
  // #/view/tab/arg...; the inbox has no tabs, its argument is a card (12 or owner/repo/12).
  if (view === "inbox") return { view, tab: "", arg: rest.join("/") };
  return { view, tab: rest[0] ?? "", arg: rest.slice(1).join("/") };
}

let route = parse();
const subs = new Set<() => void>();
window.addEventListener("hashchange", () => {
  route = parse();
  subs.forEach((f) => f());
});

export function useRoute(): Route {
  return useSyncExternalStore(
    (f) => (subs.add(f), () => void subs.delete(f)),
    () => route,
  );
}

/** Go to a view (and tab, and argument). */
export function go(view: string, tab = "", arg = "") {
  location.hash = `#/${view}${tab ? "/" + tab : ""}${arg ? "/" + arg : ""}`;
}
