import app from 'flarum/forum/app';

/**
 * 解析/合成 Flarum 的 q 参数，保留 tag: 语义
 * 约定：tag: 后接 slug（与路由一致）
 */
export function getCurrentQ(): string {
  const p = (app.search && typeof app.search.params === 'function') ? app.search.params() : {};
  return (p?.q as string) || '';
}

export function parseQ(q: string): { rest: string; tagSlugs: string[] } {
  const parts = (q || '').trim().split(/\s+/).filter(Boolean);
  const tags: string[] = [];
  const restParts: string[] = [];

  for (const p of parts) {
    const m = /^tag:(.+)$/i.exec(p);
    if (m) tags.push(m[1]);
    else restParts.push(p);
  }

  return { rest: restParts.join(' '), tagSlugs: Array.from(new Set(tags)) };
}

export function stringifyQ(parsed: { rest: string; tagSlugs: string[] }): string {
  const items: string[] = [];
  if (parsed.rest) items.push(parsed.rest.trim());
  parsed.tagSlugs.forEach((s) => items.push(`tag:${s}`));
  return items.join(' ').trim();
}

export function toggleTagSlug(rest: string, current: string[], slug: string) {
  const set = new Set(current);
  if (set.has(slug)) set.delete(slug);
  else set.add(slug);
  return { rest, tagSlugs: Array.from(set) };
}

export function clearTagsInQ(q: string) {
  const { rest } = parseQ(q);
  return { rest, tagSlugs: [] as string[] };
}
