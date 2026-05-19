// Pure tag-hierarchy helpers shared by the tag panel, the question
// form's attach selector, and any tag filter. The backend returns a
// FLAT list ordered by an id-based materialized `path`; callers rebuild
// structure from these. No React here (unit-tested in tagTree.test.ts).

import type { Tag } from "../../lib/qbank";

/** Depth from the id-based path: a root has 1 segment => depth 0. */
export function depthOf(tag: Tag): number {
  return tag.path.split("/").length - 1;
}

/** A new array sorted by `path` (stable tree order); input untouched. */
export function sortByPath(tags: Tag[]): Tag[] {
  return tags.slice().sort((a, b) => a.path.localeCompare(b.path));
}

/** children grouped by parent_id (key `null` = roots); siblings by name. */
export function byParent(tags: Tag[]): Map<string | null, Tag[]> {
  const m = new Map<string | null, Tag[]>();
  for (const tag of tags) {
    const arr = m.get(tag.parent_id) ?? [];
    arr.push(tag);
    m.set(tag.parent_id, arr);
  }
  for (const arr of m.values()) {
    arr.sort((a, b) => a.name.localeCompare(b.name));
  }
  return m;
}

/** True iff `candidate` is `root` or a descendant (path prefix). */
export function inSubtree(candidate: Tag, root: Tag): boolean {
  return (
    candidate.path === root.path ||
    candidate.path.startsWith(root.path + "/")
  );
}

/** Depth-first pre-order flatten; roots & siblings ordered by name. */
export function flattenInTreeOrder(tags: Tag[]): Tag[] {
  const m = byParent(tags);
  const out: Tag[] = [];
  const walk = (parentId: string | null) => {
    for (const node of m.get(parentId) ?? []) {
      out.push(node);
      walk(node.id);
    }
  };
  walk(null);
  return out;
}
