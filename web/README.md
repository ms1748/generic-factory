# The dashboard

React 19 + Tailwind v4 + shadcn-style components on Radix, built by Vite into `web/dist`, which the dispatcher
serves. No component library at runtime beyond Radix, cmdk (the Ctrl K palette), sonner (toasts), lucide icons
and motion (the few animations).

- `npm run dev:fixture` — the page against a saved `/api/state` (`web/dev/state.json`, git-ignored; see `dev/mock.js`).
- `npm run dev:web` — against a running dispatcher on `FACTORY_PORT` (8080).
- `npm run check:web` — types. `npm run build:web` — the production build.

## Layout

| Where | What |
| --- | --- |
| `src/App.tsx` | Picks the view from the hash route; mounts the details sheet, the confirm dialog, the palette and toasts once. |
| `src/components/Shell.tsx` | Sidebar (desktop), top bar (status menu, plan usage, Pause, Stop), bottom tab bar and More sheet (phones). |
| `src/components/nav.ts` | The views, their groups and their tabs. Add a view here and in `App.tsx`. |
| `src/views/*View.tsx` | One file per view; a view with tabs takes `tab` from the route (`#/view/tab/arg`). |
| `src/components/patterns.tsx` | `PageHeader`, `Section`, `SettingRow`/`SettingList`, `Stat`, `Empty`, `IssueRef`, `Markdown`, `Segmented`. Use these so pages read alike. |
| `src/components/ui/` | The primitives (button, card, badge, inputs, switch, tabs, tooltip, sheet, dialog, menu). |
| `src/components/magic.tsx` | The accents: `NumberTicker`, `BorderBeam` (live runs), `Dot`, `Shimmer` ("working"), `Spotlight`. Use sparingly. |
| `src/components/charts.tsx` | Plain-SVG `BarChart`, `Spark`, `Ring`, `Timeline`; colours from `COLORS`. |
| `src/components/DetailSheet.tsx` | The details of any card or PR (thread, actions, reply box), a lane's prompt or a trial report. Open it with `openItem` / `openPrompt` / `openTrial` from `lib/overlays.ts`. |
| `src/lib/` | `api.ts` (state store, `control()`), `systems.ts`, `router.ts`, `overlays.ts`, `questions.ts` (what a waiting card asks), `format.ts`, `md.ts` (safe Markdown), `theme.ts`. |

## Rules

- Anything with a number or a title opens something: a card or PR opens the details sheet, an issue number links to GitHub.
- One line of copy at most under a heading; longer explanations go in a `Tip`.
- A setting is one `SettingRow`: label and short hint on the left, the control on the right.
- Colours are the theme tokens (`text-ok`, `bg-warn/10`, `text-brand`, `text-muted-foreground`), never hex, so dark and light both work.
- Every view works at 375 px wide without horizontal page scroll.
- Controls that start runs, stop the factory or change GitHub go through `confirm()` first.
- The page's CSP allows only its own origin: fonts and icons are bundled, nothing loads from a CDN.
