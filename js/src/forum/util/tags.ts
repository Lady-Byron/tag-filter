import app from 'flarum/forum/app';

type ForumTagCategory = {
  id: number | string;
  name: string;
  slug: string | null;
  order: number | null;
  tagIds: (number | string)[];
};

let warmupPromise: Promise<any> | null = null;

/** 后台预热：把可见标签（含 parent 关系）一次拉进 store；多次调用复用同一 Promise */
export function warmupTags() {
  if (!warmupPromise) {
    warmupPromise = app.store
      .find('tags', { include: 'parent', 'page[limit]': 999 })
      .catch(() => {}); // 静默失败
  }
  return warmupPromise;
}

/** 仅在“分类里需要的 tag”缺失时才触发请求；否则立即返回 */
export async function ensureCategoryTagsLoaded() {
  const cats = (app.forum.attribute('tagCategories') as ForumTagCategory[] | undefined) || [];
  if (!cats.length) return;

  const need = new Set<string>();
  cats.forEach((g) => (g.tagIds || []).forEach((id) => need.add(String(id))));

  const have = new Set(app.store.all('tags').map((t: any) => String(t.id())));
  const missing = [...need].some((id) => !have.has(id));
  if (missing) await warmupTags();
}
