import app from 'flarum/forum/app';
import { extend } from 'flarum/common/extend';
import IndexPage from 'flarum/forum/components/IndexPage';
import Button from 'flarum/common/components/Button';
import TagFilterModal from './components/TagFilterModal';

const EXT_ID = 'lady-byron-tag-filter';

app.initializers.add(EXT_ID, () => {
  // 在首页工具栏加一个“标签”按钮（权重接近原 tags-filter）
  extend(IndexPage.prototype as any, 'viewItems', function (items: any) {
    items.add(
      'lady-byron-tag-filter',
      <Button className="Button" icon="fas fa-filter" onclick={() => app.modal.show(TagFilterModal)}>
        {app.translator.trans('lady-byron-tag-filter.forum.toolbar.button')}
      </Button>,
      -15
    );
  });
});
