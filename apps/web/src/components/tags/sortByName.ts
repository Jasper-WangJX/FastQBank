// Pure helper. The backend returns tags ordered by name already, but the
// frontend may merge in newly-created tags before re-fetching; using this
// keeps in-memory order stable.

import type { Tag } from "../../lib/qbank";

export function sortByName(tags: Tag[]): Tag[] {
  return tags.slice().sort((a, b) => a.name.localeCompare(b.name));
}
