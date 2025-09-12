import app from 'flarum/forum/app';
import { extend } from 'flarum/common/extend';
import IndexPage from 'flarum/forum/components/IndexPage';
import Button from 'flarum/common/components/Button';
import TagFilterModal from './components/TagFilterModal';
import { parseQ } from './util/query';
import { warmupTags, ensureCategoryTagsLoaded } from './util/tags';

const EXT_ID = 'lady-byron-tag-filter';

/* -------------------- 滚动恢复（温和版，无“推进加载”） -------------------- */
type SavedState = {
  y: number;     // 离开时的 scrollY（兜底）
  href?: string; // 视口最上方帖子的链接（可精确定位）
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

    // 抓“视口最上方”的列表项（用作锚点）
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

/** 在内容高度足够后再恢复到 y，避免早滚失败（不触发“加载更多”） */
function restoreScrollSafely(y: number) {
  let tries = 0;
  const maxTries = 40; // ~2s
  const tick = () => {
    const h =
      document.documentElement?.scrollHeight ||
      document.body?.scrollHeight ||
      0;
    if (h > y + 50 || tries >= maxTries) {
      requestAnimationFrame(() => window.scrollTo(0, y));
    } else {
      tries++;
      setTimeout(tick, 50);
    }
  };
  tick();
}

async function restoreScroll(state: SavedState) {
  const offset = headerOffsetGuess();
  const target = findTargetElement(state);
  if (target) {
    const y = window.scrollY + target.getBoundingClientRect().top - offset - 8;
    window.scrollTo(0, Math.max(0, y));
    return;
  }
  // 找不到锚点时，退回到 y（等待高度就绪，不推动页面到底部）
  const wantY = Math.max(0, (state.y || 0) - offset);
  restoreScrollSafely(wantY);
}

/* -------------------- 初始化（保留原功能） -------------------- */
app.initializers.add(EXT_ID, () => {
  // 不更改浏览器的 history.scrollRestoration；只托管 Page 的置顶行为
  // —— 工具栏按钮逻辑（原样保留） ——
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

  /* -------------------- 列表页滚动恢复挂载（温和版） -------------------- */
  // 1) 关闭 Page 默认“切页置顶”和浏览器内部还原由 Page 托管（不影响其它页面）
  extend(IndexPage.prototype as any, 'oninit', function () {
    try {
      (this as any).scrollTopOnCreate = false;
      (this as any).useBrowserScrollRestoration = false;
    } catch {}
  });

  // 2) 挂载后若有保存状态则恢复（不推动页面到底部）
  extend(IndexPage.prototype as any, 'oncreate', function () {
    try {
      const state = parseSaved();
      if (state) restoreScroll(state);
    } catch {}
  });

  // 3) 离开时保存当前位置（含锚点信息）
  extend(IndexPage.prototype as any, 'onremove', function () {
    saveCurrentState();
  });

  // 4) 保险：点击进入主题前先保存一次（不改变滚动，仅保存）
  if (!(window as any).__lbtcScrollGuardInstalled) {
    (window as any).__lbtcScrollGuardInstalled = true;
    document.addEventListener(
      'click',
      (ev) => {
        const target = ev.target as HTMLElement | null;
        const a = target && (target.closest?.('a[href*="/d/"]') as HTMLAnchorElement | null);
        if (a) saveCurrentState();
      },
      { capture: true, passive: true }
    );
  }
});
