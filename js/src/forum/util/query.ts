import app from 'flarum/forum/app';

/**
 * 解析/合成 Flarum 的 q 参数，保留 tag: 语义
 * 约定：tag: 后接 slug（与路由一致）
 */

export interface ParsedQ {
  rest: string;
  tagSlugs: string[];
}

/**
 * 从当前 SearchState 读取 q；不做任何语义解析，只是拿原始字符串。
 */
export function getCurrentQ(): string {
  const p =
    app.search && typeof app.search.params === 'function'
      ? app.search.params()
      : {};
  return (p?.q as string) || '';
}

/**
 * 把 q 拆成自由搜索部分（rest）与 tag:slug 数组。
 *
 * 兼容两种形式：
 *  - "tag:jobs tag:Guan-Yu"
 *  - "tag:jobs+tag:Guan-Yu"（URL 或其它逻辑把空格编码为 "+" 的情况）
 *
 * 我们只把 "+tag:" 视为分隔符，避免误伤用户搜索中的普通 "+"（如 "C++"）。
 */
export function parseQ(q: string): ParsedQ {
  const normalized = (q || '')
    .trim()
    // 兼容多 tag 被 "+tag:" 串联的写法：tag:jobs+tag:Guan-Yu → tag:jobs tag:Guan-Yu
    .replace(/\+tag:/gi, ' tag:');

  const parts = normalized.split(/\s+/).filter(Boolean);
  const tags: string[] = [];
  const restParts: string[] = [];

  for (const p of parts) {
    const m = /^tag:(.+)$/i.exec(p);
    if (m) {
      tags.push(m[1]);
    } else {
      restParts.push(p);
    }
  }

  return {
    rest: restParts.join(' '),
    tagSlugs: Array.from(new Set(tags)),
  };
}

/**
 * 把解析后的结构重新拼成 q 字符串：
 *   rest + 若干 "tag:slug"（用空格分隔，由路由层负责 URL 编码）。
 */
export function stringifyQ(parsed: ParsedQ): string {
  const items: string[] = [];

  if (parsed.rest) {
    items.push(parsed.rest.trim());
  }

  parsed.tagSlugs.forEach((s) => items.push(`tag:${s}`));

  return items.join(' ').trim();
}

/**
 * 在现有 tagSlugs 中切换某个 slug（在/不在则加/减），返回新的 ParsedQ 片段。
 */
export function toggleTagSlug(rest: string, current: string[], slug: string): ParsedQ {
  const set = new Set(current);

  if (set.has(slug)) {
    set.delete(slug);
  } else {
    set.add(slug);
  }

  return { rest, tagSlugs: Array.from(set) };
}

/**
 * 清除 q 中所有 tag: 条件，只保留自由搜索部分（rest）。
 */
export function clearTagsInQ(q: string): ParsedQ {
  const { rest } = parseQ(q);
  return { rest, tagSlugs: [] };
}

