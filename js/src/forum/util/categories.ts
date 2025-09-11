import app from 'flarum/forum/app';
import type Tag from 'flarum/tags/common/models/Tag';

export interface ForumTagCategory {
  id: number;
  name: string;
  slug: string | null;
  order: number | null;
  tagIds: number[];
}

const LS_KEY = 'lbtc.tagfilter.collapsed';

export function getCategories(): ForumTagCategory[] {
  const raw = app.forum.attribute('tagCategories') as ForumTagCategory[] | undefined;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((g) => ({ ...g, order: g.order ?? Number.MAX_SAFE_INTEGER, tagIds: g.tagIds || [] }))
    .sort((a, b) => (a.order! - b.order!) || (a.id - b.id));
}

export function pickTagsInCategories(tags: Tag[], cats: ForumTagCategory[]) {
  const tagById = new Map<number, Tag>(tags.map((t) => [Number(t.id()), t]));

  const grouped = cats
    .map((g) => {
      const list = (g.tagIds || []).map((id) => tagById.get(Number(id))).filter(Boolean) as Tag[];
      return { group: g, tags: list };
    })
    .filter((e) => e.tags.length);

  const inGroup = new Set<number>();
  grouped.forEach((e) => e.tags.forEach((t) => inGroup.add(Number(t.id()))));

  const ungrouped = tags.filter((t) => !inGroup.has(Number(t.id())));

  return { grouped, ungrouped };
}

// 折叠状态持久化
export function loadCollapsed(): Record<string, boolean> {
  try {
    const v = localStorage.getItem(LS_KEY);
    return v ? JSON.parse(v) : {};
  } catch { return {}; }
}
export function saveCollapsed(map: Record<string, boolean>) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(map)); } catch {}
}
