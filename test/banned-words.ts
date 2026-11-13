// Words that tie the code to one deployment: a project's name, an account, machine names and models. The
// public tree must not contain them (test/public-tree.test.ts), and nothing the factory writes by default
// may either (test/install.test.ts). Each is split in two so this file doesn't trip its own check.

const join = (...parts: string[][]) => parts.map((p) => p.join(""));

/** Case-insensitive patterns, one per word, with a plain name for the report. */
export const BANNED: { name: string; re: RegExp }[] = [
  ...join(["tess", "ellate"], ["tess", "era"], ["ms", "1748"], ["opti", "plex"], ["gold", "berg"], ["src-", "tauri"], ["desktop-", "q1"]).map((w) => ({
    name: w,
    re: new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"),
  })),
  { name: "a GPU model as a machine name", re: new RegExp(`\\b(?:${["50", "70"].join("")}|${["30", "70"].join("")})\\b`) },
  { name: "a GPU model by name", re: new RegExp(`rtx\\s*${["30", "80"].join("")}`, "i") },
  { name: "the owner's games PC by name", re: new RegExp(`\\bgaming[- ]${"pc"}\\b`, "i") },
  { name: "an issue reference into the owner's repos", re: new RegExp(`\\b(?:${["tess", "ellate"].join("")}|factory)#\\d+`, "i") },
  { name: "the owner's controller tests", re: new RegExp(`virtual[- ]${"pad"}s?\\b`, "i") },
];

/** The words found in `text`, by name. */
export const bannedIn = (text: string): string[] => BANNED.filter((b) => b.re.test(text)).map((b) => b.name);
