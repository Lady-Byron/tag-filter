import app from 'flarum/forum/app';
import { extend } from 'flarum/common/extend';
import IndexPage from 'flarum/forum/components/IndexPage';
import Button from 'flarum/common/components/Button';
import TagFilterModal from './components/TagFilterModal';
import { parseQ } from './util/query';
import { warmupTags, ensureCategoryTagsLoaded } from './util/tags';

const EXT_ID = 'lady-byron-tag-filter';

/* -------------------- 滚动恢复（温和版，仅在“从帖子返回”时启用） -------------------- */
type SavedState = { y: number; href?: string; id?: string };

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
function pendingKey(): string {
  return `lbtc:scroll:pending:${getRouteKey()}`;
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

    // 视口最上方的列表项（用于更精确的回位）
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

/** 内容高度足够后再滚到 y（不会去推“加载更多”） */
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
  const wantY = Math.max(0, (state.y || 0) - offset);
  restoreScrollSafely(wantY);
}

/* -------------------- 初始化（原功能保持不变） -------------------- */
app.initializers.add(EXT_ID, () => {
  // —— 工具栏按钮（你原有逻辑） ——
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

  /* -------------------- 列表页滚动恢复挂载（只在“从帖子返回”时执行） -------------------- */
  extend(IndexPage.prototype as any, 'oninit', function () {
    try {
      (this as any).scrollTopOnCreate = false;
      (this as any).useBrowserScrollRestoration = false;
    } catch {}
  });

  // 仅当 pending 标记存在且匹配当前路由时才恢复
  extend(IndexPage.prototype as any, 'oncreate', function () {
    try {
      const pendingRaw = sessionStorage.getItem(pendingKey());
      if (!pendingRaw) return;                           // 非“返回”场景：不恢复
      const state = parseSaved();
      if (!state) return;
      restoreScroll(state);
      sessionStorage.removeItem(pendingKey());          // 用一次就清
    } catch {}
  });

  extend(IndexPage.prototype as any, 'onremove', function () {
    saveCurrentState();
  });

  // 点击进入帖子前，保存状态 + 打上“待返回”标记（仅限本路由）
  if (!(window as any).__lbtcScrollGuardInstalled) {
    (window as any).__lbtcScrollGuardInstalled = true;
    document.addEventListener(
      'click',
      (ev) => {
        const target = ev.target as HTMLElement | null;
        const a = target && (target.closest?.('a[href*="/d/"]') as HTMLAnchorElement | null);
        if (a) {
          saveCurrentState();
          try {
            sessionStorage.setItem(pendingKey(), JSON.stringify({ t: Date.now() }));
          } catch {}
        }
      },
      { capture: true, passive: true }
    );

    // 刷新/关闭页前清掉当前路由的残留状态，避免刷新时误恢复
    window.addEventListener('beforeunload', () => {
      try {
        sessionStorage.removeItem(storageKey());
        sessionStorage.removeItem(pendingKey());
      } catch {}
    });
  }
});
