import app from 'flarum/forum/app';
import { extend } from 'flarum/common/extend';
import IndexPage from 'flarum/forum/components/IndexPage';
import Button from 'flarum/common/components/Button';
import TagFilterModal from './components/TagFilterModal';
import { parseQ } from './util/query';
import { warmupTags, ensureCategoryTagsLoaded } from './util/tags';

const EXT_ID = 'lady-byron-tag-filter';

/* -------------------- 滚动恢复：工具函数 -------------------- */
type SavedState = {
  y: number;                 // 离开时的 scrollY（兜底）
  href?: string;             // 视口最上方帖子的链接（优先用它定位）
  id?: string;               // 视口最上方帖子的 data-id（可选）
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
  // 估算一个顶部偏移（有固定头部时避免被盖住），按需微调
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

    // 寻找“视口最上方”的帖子项
    let topEl: HTMLElement | null = null;
    const items = Array.from(document.querySelectorAll<HTMLElement>('li.DiscussionListItem'));
    let minPos = Infinity;
    const topEdge = headerOffsetGuess();

    for (const li of items) {
      const r = li.getBoundingClientRect();
      if (r.bottom <= topEdge) continue;            // 完全在头部上方的忽略
      if (r.top >= topEdge && r.top < minPos) {     // 最靠近视口顶部的项
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
    if (typeof s?.y !== 'number') return null;
    return s;
  } catch {
    return null;
  }
}

function findTargetElement(state: SavedState): HTMLElement | null {
  // 1) 优先用 data-id
  if (state.id) {
    const byId = document.querySelector<HTMLElement>(`li.DiscussionListItem[data-id="${state.id}"]`);
    if (byId) return byId;
  }
  // 2) 再用 href 里 /d/数字 来匹配
  if (state.href) {
    // 取 /d/123 的数字部分
    const m = state.href.match(/\/d\/(\d+)/);
    if (m) {
      const num = m[1];
      // 列表卡片里通常都有到主题的链接
      const byHref =
        document.querySelector<HTMLElement>(`li.DiscussionListItem a[href*="/d/${num}"]`)?.closest('li.DiscussionListItem') as HTMLElement | null;
      if (byHref) return byHref;
    }
  }
  return null;
}

async function restoreScroll(state: SavedState) {
  // 目标：尽量把“当时视口最上方的帖子”滚回到视口上缘（减去头部）
  const offset = headerOffsetGuess();
  const targetElNow = findTargetElement(state);
  if (targetElNow) {
    const y = window.scrollY + targetElNow.getBoundingClientRect().top - offset - 8;
    window.scrollTo(0, Math.max(0, y));
    return;
  }

  // 如果目标还没出现在 DOM 里，说明需要“加载更多”
  // 我们通过把页面滚近底部来触发 Flarum 的无限加载，然后再查找目标
  const MAX_STEPS = 160; // ~8s（50ms 一步）
  let steps = 0;

  await new Promise<void>((resolve) => {
    const tryLoad = () => {
      const el = findTargetElement(state);
      if (el) {
        const y = window.scrollY + el.getBoundingClientRect().top - offset - 8;
        window.scrollTo(0, Math.max(0, y));
        return resolve();
      }

      // 还没有，推动一次加载：滚到接近底部，触发列表的 load more
      const docH = document.documentElement.scrollHeight || document.body.scrollHeight || 0;
      const nearBottom = Math.max(0, docH - window.innerHeight - 2);
      window.scrollTo(0, nearBottom);

      steps++;
      if (steps >= MAX_STEPS) {
        // 兜底：直接按 y 恢复（哪怕还不完全准确，也比停在中间好）
        window.scrollTo(0, Math.max(0, (state.y || 0) - offset));
        return resolve();
      }
      setTimeout(tryLoad, 50);
    };
    tryLoad();
  });
}

/* -------------------- 初始化 -------------------- */
app.initializers.add(EXT_ID, () => {
  // 禁止浏览器“半自动”滚动恢复，避免回到页面中部
  try {
    if ('scrollRestoration' in history) (history as any).scrollRestoration = 'manual';
  } catch {}

  // --- 工具栏按钮：保持你原来的功能 ---
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

  /* -------------------- 列表页滚动恢复：挂载到 IndexPage -------------------- */
  // 1) 关闭 Page 默认置顶/浏览器还原（由我们托管）
  extend(IndexPage.prototype as any, 'oninit', function () {
    try {
      (this as any).scrollTopOnCreate = false;
      (this as any).useBrowserScrollRestoration = false;
    } catch {}
  });

  // 2) 挂载后尝试恢复（优先按“帖子锚点”，不足再按 y 兜底）
  extend(IndexPage.prototype as any, 'oncreate', function () {
    try {
      const state = parseSaved();
      if (state) restoreScroll(state);
    } catch {}
  });

  // 3) 离开时保存位置（含“视口最上方帖子”信息）
  extend(IndexPage.prototype as any, 'onremove', function () {
    saveCurrentState();
  });

  // 4) 保险：点击进入主题卡片时先保存一次（防止某些情况下 onremove 发生较晚）
  if (!(window as any).__lbtcScrollGuardInstalled) {
    (window as any).__lbtcScrollGuardInstalled = true;
    document.addEventListener(
      'click',
      (ev) => {
        const target = ev.target as HTMLElement | null;
        const a = target && (target.closest?.('a[href*="/d/"]') as HTMLAnchorElement | null);
        if (a) {
          saveCurrentState();
        }
      },
      { capture: true, passive: true }
    );
  }
});
