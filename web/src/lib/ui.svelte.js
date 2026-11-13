// Page-level UI state: the theme (remembered on this browser) and the current view from the URL hash
// (#/board, #/runs/42, ...), so views can be bookmarked and the back button works.

// Dark ("midnight") and Light ("daylight"); Aurora and Slate were retired in the 2026-11 redesign.
const THEMES = ["system", "midnight", "daylight"];
const RETIRED = { aurora: "midnight", slate: "midnight" };

function stored(key, fallback) {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

export const ui = $state({
  theme: (() => {
    const t = RETIRED[stored("factory.theme", "system")] ?? stored("factory.theme", "system");
    return THEMES.includes(t) ? t : "system";
  })(),
  view: "overview",
  arg: "",
});

export const themes = THEMES;
export const themeNames = { system: "System", midnight: "Dark", daylight: "Light" };

export function setTheme(t) {
  ui.theme = t;
  try {
    localStorage.setItem("factory.theme", t);
  } catch {
    // private mode: just not remembered
  }
  apply();
}

function apply() {
  if (ui.theme === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = ui.theme;
}

const VIEWS = ["overview", "board", "ideas", "runs", "activity", "lanes", "devices", "perf", "systems", "logs", "reports", "data", "links", "settings"];
function route() {
  const [view, arg] = location.hash.replace(/^#\/?/, "").split("/");
  ui.view = VIEWS.includes(view) ? view : "overview";
  ui.arg = arg ?? "";
}

export function go(view, arg = "") {
  location.hash = `#/${view}${arg ? "/" + arg : ""}`;
}

apply();
route();
window.addEventListener("hashchange", route);
