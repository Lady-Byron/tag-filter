import app from 'flarum/forum/app';
import { extend } from 'flarum/common/extend';
import IndexPage from 'flarum/forum/components/IndexPage';
import Button from 'flarum/common/components/Button';
import TagFilterModal from './components/TagFilterModal';
import { parseQ } from './util/query';
import { warmupTags, ensureCategoryTagsLoaded } from './util/tags';

const EXT_ID = 'lady-byron-tag-filter';

/* ================== 滚动恢复（仅“返回”触发，等待首屏后恢复） ================== */
type SavedState = {
  y: number;
  href?: string;
  id?: string;
  ts: number;
};

const SAVE_TTL_MS = 10 * 60 * 1000; // 10 分钟
const RESTORE_MAX_MS = 6000;        // 恢复最多尝试 6s
const PREFETCH_LIMIT = 6;           // 最多温和预取 6 页

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
function topListItem(): HTMLElement | null {
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
  return topEl;
}
function saveCurrentState() {
  try {
    const y = window.scrollY || document.documentElement?.scrollTop || document.body?.scrollTop || 0;
    const el = topListItem();
    let href: string | undefined;
    let id: string | undefined;
    if (el) {
      id = el.getAttribute('data-id') || undefined;
      const a = el.querySelector('a[href*="/d/"]') as HTMLAnchorElement | null;
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
function hasAnyListItems(): boolean {
  return document.querySelector('li.DiscussionListItem') !== null;
}
function waitForFirstPaint(maxMs = 1500): Promise<void> {
  // 等待到列表出现首个卡片（首屏渲染完毕），或超时
  const start = performance.now();
  return new Promise((resolve) => {
    const tick = () => {
      if (hasAnyListItems() || performance.now() - start > maxMs) return resolve();
      setTimeout(tick, 50);
    };
    tick();
  });
}
async function gentlePrefetchUntilVisible(saved: SavedState, pageLimit = PREFETCH_LIMIT, maxMs = RESTORE_MAX_MS / 1.5) {
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
function scrollToAnchor(el: HTMLElement) {
  const offset = headerOffsetGuess();
  const y = window.scrollY + el.getBoundingClientRect().top - offset - 8;
  window.scrollTo(0, Math.max(0, y));
}
function scrollToYIfValid(y: number) {
  const doc = document.documentElement || document.body;
  const maxY = Math.max(0, (doc.scrollHeight || 0) - window.innerHeight);
  if (y <= maxY) window.scrollTo(0, y);
}

/* --------- 仅“返回”触发恢复：安装全局返回探测 --------- */
(function installBackNavDetector() {
  if ((window as any).__lbtcBackDetectorInstalled) return;
  (window as any).__lbtcBackDetectorInstalled = true;
  window.addEventListener('popstate', () => { (window as any).__lbtcShouldRestore = true; });
  window.addEventListener('pageshow', (e: PageTransitionEvent) => {
    if ((e as any).persisted) (window as any).__lbtcShouldRestore = true;
  });
  if ((window as any).__lbtcShouldRestore === undefined) (window as any).__lbtcShouldRestore = false;
})();

/* ========================= 原有功能（按钮/弹窗） ========================= */
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

    const bySlug = new Map(app.store.all('tags').map((t: any) => [t.slug?.(), t]));
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
      if (i < tagSlugs.length - 1) parts.push(<span key={`tl-sep-${i}`} className="lbtc-tf-ToolbarSep">{' '}</span>);
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

  /* ========================= 列表页：滚动恢复挂载 ========================= */

  // 关闭 Page 的置顶/浏览器内部还原，由我们在“返回”场景托管
  extend(IndexPage.prototype as any, 'oninit', function () {
    try {
      (this as any).scrollTopOnCreate = false;
      (this as any).useBrowserScrollRestoration = false;

      // 若是“返回”，在这一页临时禁用浏览器自动还原，避免先被放到中段
      if ((window as any).__lbtcShouldRestore === true && 'scrollRestoration' in history) {
        (window as any).__lbtcPrevScrollRestoration = (history as any).scrollRestoration;
        (history as any).scrollRestoration = 'manual';
      }
    } catch {}
  });

  // 恢复逻辑：等待首屏出现 -> 精确锚点；失败则尝试温和预取；仍失败再用 y（合法才滚）
  extend(IndexPage.prototype as any, 'oncreate', function () {
    const key = storageKey();

    const tryRestore = async () => {
      if ((window as any).__lbtcShouldRestore !== true) return;
      const saved = parseSaved();
      if (!saved) return finish(false);

      // 用户一旦主动滚动，放弃恢复（不和用户抢）
      let aborted = false;
      const abort = () => { aborted = true; };
      const removeAborters = () => {
        window.removeEventListener('wheel', abort, { capture: true } as any);
        window.removeEventListener('touchstart', abort, { capture: true } as any);
        window.removeEventListener('keydown', abort, { capture: true } as any);
      };
      window.addEventListener('wheel', abort, { capture: true, passive: true });
      window.addEventListener('touchstart', abort, { capture: true, passive: true });
      window.addEventListener('keydown', abort, { capture: true });

      const start = performance.now();

      // 1) 等首屏（避免在 0 高度时计算锚点）
      await waitForFirstPaint(1500);

      // 2) 循环尝试：锚点 -> 预取 -> y（均不滚到底）
      let success = false;
      while (!aborted && performance.now() - start < RESTORE_MAX_MS) {
        const target = findTargetElement(saved);
        if (target) {
          scrollToAnchor(target);
          success = true;
          break;
        }
        // 首次进入或数据不够：温和预取一小段（不滚动页面）
        const prefetched = await gentlePrefetchUntilVisible(saved, PREFETCH_LIMIT, RESTORE_MAX_MS / 1.5);
        if (prefetched) {
          const t2 = findTargetElement(saved);
          if (t2) {
            scrollToAnchor(t2);
            success = true;
            break;
          }
        }
        // 最后用 y 尝试一次（仅当 y 合法时）
        const offset = headerOffsetGuess();
        const wantY = Math.max(0, (saved.y || 0) - offset);
        const doc = document.documentElement || document.body;
        const maxY = Math.max(0, (doc.scrollHeight || 0) - window.innerHeight);
        if (wantY <= maxY) {
          window.scrollTo(0, wantY);
          success = true;
        }
        break;
      }

      removeAborters();
      finish(success);
    };

    const finish = (success: boolean) => {
      // 成功才记 restoredKey；失败让 onupdate 再试一次
      if (success) (window as any).__lbtcRestoredKey = key;
      (window as any).__lbtcShouldRestore = false;

      // 恢复浏览器默认滚动策略
      try {
        if ('scrollRestoration' in history) {
          const prev = (window as any).__lbtcPrevScrollRestoration;
          (history as any).scrollRestoration = prev || 'auto';
          (window as any).__lbtcPrevScrollRestoration = undefined;
        }
      } catch {}
    };

    // 如果本次不是“返回”，直接退出
    if ((window as any).__lbtcShouldRestore !== true) return;

    // 避免重复恢复
    if ((window as any).__lbtcRestoredKey === key) {
      (window as any).__lbtcShouldRestore = false;
      tryRestore(); // 仍然确保恢复 scrollRestoration
      return;
    }

    // 开始恢复
    tryRestore();
  });

  // 慢网/慢机：初次没成功，渲染更新后再试一次（仍仅“返回”时）
  extend(IndexPage.prototype as any, 'onupdate', function () {
    if ((window as any).__lbtcShouldRestore !== true) return;
    const key = storageKey();
    if ((window as any).__lbtcRestoredKey === key) return;

    // 触发一次轻量的再尝试
    const saved = parseSaved();
    if (!saved) {
      (window as any).__lbtcShouldRestore = false;
      return;
    }
    const target = findTargetElement(saved);
    if (target) {
      scrollToAnchor(target);
      (window as any).__lbtcRestoredKey = key;
      (window as any).__lbtcShouldRestore = false;
      try {
        if ('scrollRestoration' in history) {
          const prev = (window as any).__lbtcPrevScrollRestoration;
          (history as any).scrollRestoration = prev || 'auto';
          (window as any).__lbtcPrevScrollRestoration = undefined;
        }
      } catch {}
    }
  });

  // 离开时保存位置；并在进入主题的 pointerdown/click 捕获阶段先保存一次（移动端更稳）
  extend(IndexPage.prototype as any, 'onremove', function () { saveCurrentState(); });

  if (!(window as any).__lbtcScrollGuardInstalled) {
    (window as any).__lbtcScrollGuardInstalled = true;
    const handler = (ev: Event) => {
      const a = (ev.target as HTMLElement | null)?.closest?.('a[href*="/d/"]') as HTMLAnchorElement | null;
      if (a) saveCurrentState();
    };
    document.addEventListener('pointerdown', handler, { capture: true, passive: true });
    document.addEventListener('click', handler, { capture: true, passive: true });
  }
});
