import app from 'flarum/forum/app';
import { extend } from 'flarum/common/extend';
import IndexPage from 'flarum/forum/components/IndexPage';
import Button from 'flarum/common/components/Button';
import TagFilterModal from './components/TagFilterModal';
import { parseQ } from './util/query';
import { warmupTags } from './util/tags';   // ★ 新增

const EXT_ID = 'lady-byron-tag-filter';

app.initializers.add(EXT_ID, () => {
  function toolbarLabel() {
    const q = (app.search && typeof app.search.params === 'function') ? app.search.params().q || '' : '';
    const { tagSlugs } = parseQ(q);
    if (!tagSlugs.length) return app.translator.trans('lady-byron-tag-filter.forum.toolbar.button');

    const bySlug = new Map(app.store.all('tags').map((t: any) => [t.slug(), t]));
    const parts: Mithril.Children[] = [];
    tagSlugs.forEach((slug, i) => {
      const tag = bySlug.get(slug);
      const color = tag?.color?.() || 'var(--tag-color)';
      const name = tag?.name?.() || slug;
      parts.push(<span className="lbtc-tf-ToolbarTag" style={{ '--tag-title-color': color } as any}>{name}</span>);
      if (i < tagSlugs.length - 1) parts.push(<span className="lbtc-tf-ToolbarSep">{' '}</span>);
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
        onclick={() => app.modal.show(TagFilterModal)}
        onmouseenter={() => warmupTags()}   // ★ 悬停即预热
        onfocus={() => warmupTags()}        // ★ 键盘聚焦也预热
        oncreate={() => {
          // ★ 页面闲时预热（兼容没有 requestIdleCallback 的环境）
          const idle = (window as any).requestIdleCallback || ((fn: any) => setTimeout(fn, 300));
          idle(() => warmupTags());
        }}
      >
        {toolbarLabel()}
      </Button>,
      -15
    );
  });
});

