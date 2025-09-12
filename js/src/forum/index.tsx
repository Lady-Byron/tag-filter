import app from 'flarum/forum/app';
import { extend } from 'flarum/common/extend';
import IndexPage from 'flarum/forum/components/IndexPage';
import Button from 'flarum/common/components/Button';
import TagFilterModal from './components/TagFilterModal';
import { parseQ } from './util/query';
import { warmupTags, ensureCategoryTagsLoaded } from './util/tags';

const EXT_ID = 'lady-byron-tag-filter';

/* ========= 滚动恢复（移动端友好 & 温和预取，不滚到底部） ========= */
type SavedState = {
  y: number;     // 离开时 scrollY（兜底）
  href?: string; // 视口最上方帖子的链接（用于精确定位）
  id?: string;   // 视口最上方帖子的 data-id（可选）
};

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

    // 抓“视口最上方”的列表项（作为锚点）
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

    const state: SavedState = { y, href, id };
    sessionStorage.setItem(storageKey(), JSON.stringify(state));
  } catch {}
}

function parseSaved(): SavedState | null {
  try {
    const raw = sessionStorage.getItem(storageKey());
    if (!raw) return null;
    const s = JSON.parse(raw) as SavedState;
    return typeof s?.y === 'number' ? s : null;
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

/** 等高度足够再滚到 y；最大等待时长更宽松，适配移动端慢速渲染 */
function restoreScrollSafely(y: number, maxMs = 5000) {
  const start = performance.now();
  const step = () => {
    const h = document.documentElement?.scrollHeight || document.body?.scrollHeight || 0;
    if (h > y + 50 || performance.now() - start > maxMs) {
      requestAnimationFrame(() => window.scrollTo(0, y));
    } else {
      setTimeout(step, 60);
    }
  };
  step();
}

/** 温和预取：不滚动，只在 state 可用时调用 loadMore() 少量次，直到锚点出现或超时 */
async function gentlePrefetchUntilVisible(saved: SavedState, pageLimit = 8, maxMs = 5000) {
  const start = performance.now();
  const state: any = (app as any).discussions;
  if (!state || typeof state.loadMore !== 'function') return false;

  for (let i = 0; i < pageLimit; i++) {
    if (findTargetElement(saved)) return true;
    if (!(state.moreResults || state.hasMoreResults || state.next)) break; // 兼容不同实现
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

  // 1) 先尝试“锚点精确定位”
  let target = findTargetElement(saved);
  if (!target) {
    // 2) 锚点不在当前 DOM：温和预取若干页（不滚动、不抖动）
    const ok = await gentlePrefetchUntilVisible(saved, 8, 5000);
    if (ok) target = findTargetElement(saved);
  }
  if (target) {
    const y = window.scrollY + target.getBoundingClientRect().top - offset - 8;
    window.scrollTo(0, Math.max(0, y));
    return;
  }

  // 3) 仍找不到锚点：回退到 y（等待高度就绪），不强制触发加载
  const wantY = Math.max(0, (saved.y || 0) - offset);
  restoreScrollSafely(wantY, 5000);
}

/* ========= 初始化（保留原功能 + 安全挂钩） ========= */
app.initializers.add(EXT_ID, () => {
  /* 工具栏按钮（原样保持） */
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

  /* ========== 列表页滚动恢复挂载（移动端增强） ========== */
  // 1) 关闭 Page 的“切页置顶/浏览器内部还原”，交给我们托管（避免与系统半自动还原打架）
  extend(IndexPage.prototype as any, 'oninit', function () {
    try {
      (this as any).scrollTopOnCreate = false;
      (this as any).useBrowserScrollRestoration = false;
    } catch {}
  });

  // 2) 挂载后尝试恢复（一次性）
  extend(IndexPage.prototype as any, 'oncreate', function () {
    try {
      const key = storageKey();
      if ((window as any).__lbtcRestoredKey === key) return;
      const saved = parseSaved();
      if (saved) {
        (window as any).__lbtcRestoredKey = key;
        restoreScroll(saved);
      }
    } catch {}
  });

  // 3) 某些移动端/慢网下，列表异步更新较慢：在 onupdate 再尝试一次（若之前未成功）
  extend(IndexPage.prototype as any, 'onupdate', function () {
    try {
      const key = storageKey();
      if ((window as any).__lbtcRestoredKey === key) return;
      const saved = parseSaved();
      if (saved) {
        (window as any).__lbtcRestoredKey = key;
        restoreScroll(saved);
      }
    } catch {}
  });

  // 4) 离开时保存当前位置（含锚点）
  extend(IndexPage.prototype as any, 'onremove', function () {
    saveCurrentState();
  });

  // 5) 保险：在“pointerdown/click”捕获阶段先保存（移动端更可靠）
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

  // 6) 处理 iOS 等系统 bfcache 恢复场景（整页从缓存回到前台）
  window.addEventListener('pageshow', (e: any) => {
    try {
      // 只有回到列表路由时才尝试
      const isIndex = String((window as any).m?.route?.get?.() || location.pathname).match(/^\/(?:\?.*)?$/);
      if (!isIndex) return;

      const key = storageKey();
      if ((window as any).__lbtcRestoredKey === key) return;

      const saved = parseSaved();
      if (saved) {
        (window as any).__lbtcRestoredKey = key;
        restoreScroll(saved);
      }
    } catch {}
  });
});
