import app from 'flarum/forum/app';
import { extend } from 'flarum/common/extend';
import IndexPage from 'flarum/forum/components/IndexPage';
import Button from 'flarum/common/components/Button';
import TagFilterModal from './components/TagFilterModal';
import { parseQ } from './util/query';

const EXT_ID = 'lady-byron-tag-filter';

app.initializers.add(EXT_ID, () => {
  // 预取 tags（用于着色与名称），失败也无所谓
  if (!app.store.all('tags').length) {
    // 不 await，避免阻塞
    // @ts-ignore
    app.store.find('tags').catch(() => {});
  }

  // 生成工具栏按钮的动态标签文本（已选标签 → 彩色名称）
  function toolbarLabel() {
    const q = (app.search && typeof app.search.params === 'function') ? app.search.params().q || '' : '';
    const { tagSlugs } = parseQ(q);

    if (!tagSlugs.length) {
      return app.translator.trans('lady-byron-tag-filter.forum.toolbar.button');
    }

    const bySlug = new Map(app.store.all('tags').map((t: any) => [t.slug(), t]));
    const parts: Mithril.Children[] = [];

    tagSlugs.forEach((slug, i) => {
      const tag = bySlug.get(slug);
      const color = tag?.color?.() || 'var(--tag-color)';
      const name = tag?.name?.() || slug;

      parts.push(
        <span
          className="lbtc-tf-ToolbarTag"
          style={{ '--tag-title-color': color } as any}
          data-tag-slug={slug}
        >
          {name}
        </span>
      );

      if (i < tagSlugs.length - 1) {
        parts.push(<span className="lbtc-tf-ToolbarSep">{' '}</span>);
      }
    });

    return parts;
  }

  // 在首页工具栏加入按钮（与原 tags-filter 类似的位置/权重）
  extend(IndexPage.prototype as any, 'viewItems', function (items: any) {
    items.add(
      'lady-byron-tag-filter',
      <Button
        className="Button"
        icon="fas fa-filter"
        aria-label={app.translator.trans('lady-byron-tag-filter.forum.toolbar.button')}
        onclick={() => app.modal.show(TagFilterModal)}
      >
        {toolbarLabel()}
      </Button>,
      -15
    );
  });
});
