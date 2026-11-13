// Controls that need a confirmation first, shared by the board and the drawer.
import { control } from "./api.svelte.js";

export function buildNow(card, confirm) {
  confirm({
    title: `Build #${card.number} now?`,
    body: `"${card.title}" starts right away with the builder lane for its size, live, even if that lane is dry. It uses your Claude plan.`,
    yes: "Build now",
    action: () => control(`cards/${card.number}/build`, { repo: card.repo }),
  });
}
