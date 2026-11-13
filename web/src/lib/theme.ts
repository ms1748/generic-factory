// Dark, light or the system's, remembered on this browser.
export type Theme = "system" | "dark" | "light";

export function savedTheme(): Theme {
  try {
    const t = localStorage.getItem("factory.theme");
    // The old dashboard's names.
    if (t === "midnight" || t === "aurora" || t === "slate") return "dark";
    if (t === "daylight") return "light";
    return t === "dark" || t === "light" ? t : "system";
  } catch {
    return "system";
  }
}

const media = window.matchMedia("(prefers-color-scheme: dark)");

export function applyTheme(t: Theme) {
  const dark = t === "dark" || (t === "system" && media.matches);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.classList.toggle("light", !dark);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#09090b" : "#fafafa");
}

export function setTheme(t: Theme) {
  try {
    localStorage.setItem("factory.theme", t);
  } catch {
    // private mode: just not remembered
  }
  applyTheme(t);
}

media.addEventListener("change", () => applyTheme(savedTheme()));
applyTheme(savedTheme());
