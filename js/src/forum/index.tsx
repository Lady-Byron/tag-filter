import app from 'flarum/forum/app';
import { extend } from 'flarum/common/extend';
import IndexPage from 'flarum/forum/components/IndexPage';
import Button from 'flarum/common/components/Button';
import TagFilterModal from './components/TagFilterModal';
import { parseQ } from './util/query';
import { warmupTags, ensureCategoryTagsLoaded } from './util/tags';

const EXT_ID = 'lady-byron-tag-filter';

/* ==================== 滚动恢复（仅“返回”触发） ==================== */
type SavedState = {
  y: number;     // 离开时 scrollY（兜底）
  href?: string; // 视口最上方帖子的链接（锚点）
  id?: string;   // 视口最上方帖子的 data-id（可选）
  ts: number;    // 保存时间戳（用于过期）
};

const SAVE_TTL_MS = 10 * 60 * 1000; // 10 分钟内有效

function getRouteKey(): string {
  try {
    const m: any = (window as any).m;
    if (m?.route?.get) return String(m.route.get());
  } catch {}
  return `${location.pathname}${location.search}${location.hash || ''}`;
}
function storageKey(): string {
  return `lbtc:scroll:${getRouteKey()}`;
}

function headerOffsetGuess(): number {
  const el = document.querySelector('.App-header, .Header, header') as HTMLElement | null;
  return el ? Math.max(0, el.getBoundingClientRect().height - 4) : 0;
}

function saveCurrentState() {
  try {
    const y =
      window.scrollY ||
      document.documentElement?.scrollTop ||
      document.body?.scrollTop ||
      0;

    // 找“视口最上方”的列表项
    let topEl: HTMLElement | null = null;
    const items = Array.from(document.querySelectorAll<HTMLElement>('li.DiscussionListItem'));
    let minPos = Infinity;
    const topEdge = headerOffsetGuess();

    for (const li of items) {
      const r = li.getBoundingClientRect();
      if (r.bottom <= topEdge) continue;
      if (r.top >= topEdge && r.top < minPos) {
        topEl = li;
        minPos = r.top;
      }
    }

    let href: string | undefined;
    let id: string | undefined;

    if (topEl) {
      id = topEl.getAttribute('data-id') || undefined;
      const a = topEl.querySelector('a[href*="/d/"]') as HTMLAnchorElement | null;
      href = a?.getAttribute('href') || undefined;
    }

    const state: SavedState = { y, href, id, ts: Date.now() };
    sessionStorage.setItem(storageKey(), JSON.stringify(state));
  } catch {}
}

function parseSaved(): SavedState | null {
  try {
    const raw = sessionStorage.getItem(storageKey());
    if (!raw) return null;
    const s = JSON.parse(raw) as SavedState;
    if (typeof s?.y !== 'number' || typeof s?.ts !== 'number') return null;
    if (Date.now() - s.ts > SAVE_TTL_MS) return null;
    return s;
  } catch {
    return null;
  }
}

function findTargetElement(state: SavedState): HTMLElement | null {
  if (state.id) {
    const byId = document.querySelector<HTMLElement>(`li.DiscussionListItem[data-id="${state.id}"]`);
    if (byId) return byId;
  }
  if (state.href) {
    const m = state.href.match(/\/d\/(\d+)/);
    if (m) {
      const num = m[1];
      const byHref =
        document
          .querySelector<HTMLElement>(`li.DiscussionListItem a[href*="/d/${num}"]`)
          ?.closest('li.DiscussionListItem') as HTMLElement | null;
      if (byHref) return byHref;
    }
  }
  return null;
}

/** 等高度足够再滚到 y；不触发额外加载，不会“拉到底” */
function restoreScrollSafely(y: number, maxMs = 5000) {
  const start = performance.now();
  const step = () => {
    const doc = document.documentElement || document.body;
    const h = doc.scrollHeight || 0;
    const maxY = Math.max(0, h - window.innerHeight);
    // 若目标大于可滚动最大值，直接放弃（不滚到底）
    if (y > maxY) return;
    if (h > y + 50 || performance.now() - start > maxMs) {
      requestAnimationFrame(() => window.scrollTo(0, y));
    } else {
      setTimeout(step, 60);
    }
  };
  step();
}

/** 温和预取：仅在“返回”时用于让锚点出现；不滚动页面 */
async function gentlePrefetchUntilVisible(saved: SavedState, pageLimit = 6, maxMs = 4000) {
  const start = performance.now();
  const state: any = (app as any).discussions;
  if (!state || typeof state.loadMore !== 'function') return false;

  for (let i = 0; i < pageLimit; i++) {
    if (findTargetElement(saved)) return true;
    if (!(state.moreResults || state.hasMoreResults || state.next)) break;
    if (state.loading) {
      await new Promise((r) => setTimeout(r, 80));
      i--;
      continue;
    }
    try {
      await state.loadMore();
    } catch {
      break;
    }
    await new Promise((r) => setTimeout(r, 80));
    if (performance.now() - start > maxMs) break;
  }
  return !!findTargetElement(saved);
}

async function restoreScroll(saved: SavedState) {
  const offset = headerOffsetGuess();

  // 1) 优先锚点
  let target = findTargetElement(saved);
  if (!target) {
    // 2) “返回”场景下，温和预取一些数据让锚点出现（不滚动页面）
    const ok = await gentlePrefetchUntilVisible(saved, 6, 4000);
    if (ok) target = findTargetElement(saved);
  }
  if (target) {
    const y = window.scrollY + target.getBoundingClientRect().top - offset - 8;
    window.scrollTo(0, Math.max(0, y));
    return;
  }

  // 3) 找不到锚点时，仅在 y 合法时恢复；否则放弃（避免被拉到底）
  const doc = document.documentElement || document.body;
  const maxY = Math.max(0, (doc.scrollHeight || 0) - window.innerHeight);
  const wantY = Math.max(0, (saved.y || 0) - offset);
  if (wantY <= maxY) restoreScrollSafely(wantY, 5000);
}

/* ============== 仅“返回”时尝试恢复：导航意图探测 ============== */
// 全局标记：是否属于“返回”导航
(function installBackNavDetector() {
  // popstate：浏览器后退/前进（SPA 场景）
  window.addEventListener('popstate', () => {
    (window as any).__lbtcShouldRestore = true;
  });
  // pageshow.persisted：bfcache 恢复（iOS/Safari 等）
  window.addEventListener('pageshow', (e: PageTransitionEvent) => {
    if ((e as any).persisted) {
      (window as any).__lbtcShouldRestore = true;
    }
  });
  // 初始为 false；整页刷新不会触发以上两个事件，因而不会恢复
  if ((window as any).__lbtcShouldRestore === undefined) {
    (window as any).__lbtcShouldRestore = false;
  }
})();

/* ==================== 原有功能（按钮/弹窗） ==================== */
app.initializers.add(EXT_ID, () => {
  function toolbarLabel(): Mithril.Children {
    const q =
      app.search && typeof (app.search as any).params === 'function'
        ? ((app.search as any).params().q as string) || ''
        : '';
    const { tagSlugs } = parseQ(q);

    if (!tagSlugs.length) {
      return app.translator.trans('lady-byron-tag-filter.forum.toolbar.button');
    }

    const bySlug = new Map(
      app.store.all('tags').map((t: any) => [t.slug?.(), t])
    );

    const parts: Mithril.Children[] = [];
    tagSlugs.forEach((slug, i) => {
      const tag = bySlug.get(slug);
      const color = tag?.color?.() || 'var(--tag-color)';
      const name = tag?.name?.() || slug;

      parts.push(
        <span
          key={`tl-tag-${slug}`}
          className="lbtc-tf-ToolbarTag"
          style={{ '--tag-title-color': color } as any}
          data-tag-slug={slug}
        >
          {name}
        </span>
      );

      if (i < tagSlugs.length - 1) {
        parts.push(<span key={`tl-sep-${i}`} className="lbtc-tf-ToolbarSep">{' '}</span>);
      }
    });

    return parts;
  }

  extend(IndexPage.prototype as any, 'viewItems', function (items: any) {
    items.add(
      'lady-byron-tag-filter',
      <Button
        className="Button"
        icon="fas fa-filter"
        aria-label={app.translator.trans('lady-byron-tag-filter.forum.toolbar.button')}
        onclick={async () => {
          try { await ensureCategoryTagsLoaded(); } catch {}
          app.modal.show(TagFilterModal);
        }}
        onmouseenter={() => warmupTags()}
        onfocus={() => warmupTags()}
        oncreate={() => {
          const idle = (window as any).requestIdleCallback || ((fn: any) => setTimeout(fn, 300));
          idle(() => warmupTags());
        }}
      >
        {toolbarLabel()}
      </Button>,
      -15
    );
  });

  /* ============== 列表页挂载（仅“返回”才恢复） ============== */
  // 关闭 Page 默认“切页置顶/浏览器内部还原”，由我们在“返回”场景托管
  extend(IndexPage.prototype as any, 'oninit', function () {
    try {
      (this as any).scrollTopOnCreate = false;
      (this as any).useBrowserScrollRestoration = false;
    } catch {}
  });

  // “返回”时恢复（一次性）；刷新/直达不恢复
  extend(IndexPage.prototype as any, 'oncreate', function () {
    try {
      if ((window as any).__lbtcShouldRestore !== true) return;
      const key = storageKey();
      if ((window as any).__lbtcRestoredKey === key) return;
      const saved = parseSaved();
      if (saved) {
        (window as any).__lbtcRestoredKey = key;
        (window as any).__lbtcShouldRestore = false;
        restoreScroll(saved);
      } else {
        (window as any).__lbtcShouldRestore = false;
      }
    } catch {}
  });

  // 慢渲染时在 onupdate 再试一次（仍仅“返回”触发）
  extend(IndexPage.prototype as any, 'onupdate', function () {
    try {
      if ((window as any).__lbtcShouldRestore !== true) return;
      const key = storageKey();
      if ((window as any).__lbtcRestoredKey === key) return;
      const saved = parseSaved();
      if (saved) {
        (window as any).__lbtcRestoredKey = key;
        (window as any).__lbtcShouldRestore = false;
        restoreScroll(saved);
      } else {
        (window as any).__lbtcShouldRestore = false;
      }
    } catch {}
  });

  // 离开时保存位置（含锚点）
  extend(IndexPage.prototype as any, 'onremove', function () {
    saveCurrentState();
  });

  // 提前保存（移动端更稳定）：pointerdown/click 捕获阶段
  if (!(window as any).__lbtcScrollGuardInstalled) {
    (window as any).__lbtcScrollGuardInstalled = true;
    const handler = (ev: Event) => {
      const target = ev.target as HTMLElement | null;
      const a = target && (target.closest?.('a[href*="/d/"]') as HTMLAnchorElement | null);
      if (a) saveCurrentState();
    };
    document.addEventListener('pointerdown', handler, { capture: true, passive: true });
    document.addEventListener('click', handler, { capture: true, passive: true });
  }
});
