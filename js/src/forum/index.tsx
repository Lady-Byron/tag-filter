import app from 'flarum/forum/app';
import { extend } from 'flarum/common/extend';
import IndexPage from 'flarum/forum/components/IndexPage';
import Button from 'flarum/common/components/Button';
import TagFilterModal from './components/TagFilterModal';
import { parseQ } from './util/query';
import { warmupTags, ensureCategoryTagsLoaded } from './util/tags';

const EXT_ID = 'lady-byron-tag-filter';

/** —— 滚动记忆/恢复：辅助函数 —— */
function getRouteKey(): string {
  try {
    const m: any = (window as any).m;
    if (m?.route?.get) return String(m.route.get());
  } catch {}
  // 兜底：尽量复现“路径 + 查询 + hash”作为 key
  return `${location.pathname}${location.search}${location.hash || ''}`;
}
function scrollKey(): string {
  return `lbtc:scroll:${getRouteKey()}`;
}
/** 在内容高度足够后再恢复滚动，避免内容尚未挂载导致失败 */
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

app.initializers.add(EXT_ID, () => {
  /** —— 工具栏按钮文本（显示已选标签的小彩色片段） —— */
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
        parts.push(
          <span key={`tl-sep-${i}`} className="lbtc-tf-ToolbarSep">
            {' '}
          </span>
        );
      }
    });

    return parts;
  }

  /** —— 给主列表页加按钮（原功能保持不变） —— */
  extend(IndexPage.prototype as any, 'viewItems', function (items: any) {
    items.add(
      'lady-byron-tag-filter',
      <Button
        className="Button"
        icon="fas fa-filter"
        aria-label={app.translator.trans(
          'lady-byron-tag-filter.forum.toolbar.button'
        )}
        // 先确保分类里需要的 tag 就绪，再打开弹窗，避免入场动画期间重绘
        onclick={async () => {
          try {
            await ensureCategoryTagsLoaded();
          } catch {}
          app.modal.show(TagFilterModal);
        }}
        onmouseenter={() => warmupTags()} // 悬停即预热
        onfocus={() => warmupTags()} // 键盘聚焦也预热
        oncreate={() => {
          const idle =
            (window as any).requestIdleCallback ||
            ((fn: any) => setTimeout(fn, 300));
          idle(() => warmupTags()); // 页面空闲时预热
        }}
      >
        {toolbarLabel()}
      </Button>,
      -15
    );
  });

  /** —— 列表页：滚动位置记忆与恢复（新增逻辑） —— */
  // 1) 进入 IndexPage：关闭默认置顶/浏览器还原，由我们托管
  extend(IndexPage.prototype as any, 'oninit', function () {
    try {
      (this as any).scrollTopOnCreate = false;
      (this as any).useBrowserScrollRestoration = false;
    } catch {}
  });

  // 2) IndexPage 挂载后：若有历史位置则在内容就绪时恢复
  extend(IndexPage.prototype as any, 'oncreate', function () {
    try {
      const val = sessionStorage.getItem(scrollKey());
      if (val !== null) {
        const y = parseInt(val, 10);
        if (!Number.isNaN(y) && y > 0) {
          restoreScrollSafely(y);
        }
      }
    } catch {}
  });

  // 3) 离开 IndexPage（例如点进帖子/跳到其他页）：保存当前位置
  extend(IndexPage.prototype as any, 'onremove', function () {
    try {
      const y =
        window.scrollY ||
        document.documentElement?.scrollTop ||
        document.body?.scrollTop ||
        0;
      sessionStorage.setItem(scrollKey(), String(y));
    } catch {}
  });
});
