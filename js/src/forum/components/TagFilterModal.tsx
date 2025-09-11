import app from 'flarum/forum/app';
import Modal from 'flarum/common/components/Modal';
import Button from 'flarum/common/components/Button';
import LoadingIndicator from 'flarum/common/components/LoadingIndicator';
import Stream from 'flarum/common/utils/Stream';
import classList from 'flarum/common/utils/classList';
import sortTags from 'flarum/tags/common/utils/sortTags';
import type Tag from 'flarum/tags/common/models/Tag';
import TagChip from './TagChip';
import { getCategories, pickTagsInCategories, loadCollapsed, saveCollapsed } from '../util/categories';
import { getCurrentQ, parseQ, stringifyQ, toggleTagSlug, clearTagsInQ } from '../util/query';

type Vnode = Mithril.Vnode<Record<string, never>, TagFilterModal>;

export default class TagFilterModal extends Modal {
  private loading = true;
  private allTags: Tag[] = [];
  private filter = Stream<string>('');
  private collapsed: Record<string, boolean> = {};
  private initialized = false;

  className() { return 'lbtc-tf-Modal Modal--large'; }
  title() { return app.translator.trans('lady-byron-tag-filter.forum.toolbar.button'); }

  async oninit(vnode: Vnode) {
    super.oninit(vnode);
    if (!app.store.all('tags').length) await app.store.find('tags');
    this.allTags = app.store.all<Tag>('tags');
    this.collapsed = loadCollapsed();
    this.loading = false;
  }

  // ★ 防止包裹的 <form> 被意外提交
  onsubmit(e: SubmitEvent) { e.preventDefault(); }

  content() {
    if (this.loading) return <div className="Modal-body"><LoadingIndicator /></div>;

    const { tagSlugs: selectedSlugs } = parseQ(getCurrentQ());
    const selectedSet = new Set(selectedSlugs);

    const keyword = (this.filter() || '').trim().toLowerCase();
    const visible = keyword
      ? this.allTags.filter((t) => (`${t.name()} ${t.description() || ''}`).toLowerCase().includes(keyword))
      : this.allTags.slice();

    const cats = getCategories();

    if (cats.length) {
      const { grouped, ungrouped } = pickTagsInCategories(visible, cats);

      if (!this.initialized) {
        cats.forEach((g) => (this.collapsed[String(g.id)] ??= true));
        if (ungrouped.length) this.collapsed.__ungrouped__ ??= true;
        this.initialized = true;
        saveCollapsed(this.collapsed);
      }

      const expandAll = () => { cats.forEach((g) => (this.collapsed[String(g.id)] = false)); this.collapsed.__ungrouped__ = false; saveCollapsed(this.collapsed); m.redraw(); };
      const collapseAll = () => { cats.forEach((g) => (this.collapsed[String(g.id)] = true));  this.collapsed.__ungrouped__ = true;  saveCollapsed(this.collapsed); m.redraw(); };

      const header = this.renderHeader(selectedSlugs, expandAll, collapseAll);
      const sections: Mithril.Children[] = [];

      grouped.forEach(({ group, tags }) => {
        const key = String(group.id);
        const isCollapsed = !!this.collapsed[key];
        const sorted = sortTags(tags.slice());

        sections.push(
          <li
            className={classList('lbtc-tf-GroupHeader', { collapsed: isCollapsed })}
            role="button" aria-expanded={!isCollapsed} tabindex="0"
            onclick={() => this.toggle(key)}
            onkeydown={(e: KeyboardEvent) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), this.toggle(key))}
          >
            <i className="fas fa-chevron-down lbtc-tf-GroupHeader-caret" />
            {group.name}
          </li>
        );

        if (!isCollapsed) {
          sections.push(
            <li className="lbtc-tf-GroupBody">
              {sorted.map((t) => TagChip(t, {
                selected: selectedSet.has(t.slug()!),
                onclick: () => this.toggleSelect(t.slug()!),
              }))}
            </li>
          );
        }
      });

      if (ungrouped.length) {
        const key = '__ungrouped__';
        const isCollapsed = !!this.collapsed[key];
        const sorted = sortTags(ungrouped.slice());

        sections.push(
          <li
            className={classList('lbtc-tf-GroupHeader', { collapsed: isCollapsed })}
            role="button" aria-expanded={!isCollapsed} tabindex="0"
            onclick={() => this.toggle(key)}
            onkeydown={(e: KeyboardEvent) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), this.toggle(key))}
          >
            <i className="fas fa-chevron-down lbtc-tf-GroupHeader-caret" />
            {app.translator.trans('lady-byron-tag-filter.forum.grouped.ungrouped')}
          </li>
        );

        if (!isCollapsed) {
          sections.push(
            <li className="lbtc-tf-GroupBody">
              {sorted.map((t) => TagChip(t, {
                selected: selectedSet.has(t.slug()!),
                onclick: () => this.toggleSelect(t.slug()!),
              }))}
            </li>
          );
        }
      }

      return [
        header,
        <div className="Modal-footer">
          <ul className="lbtc-tf-GroupList">{sections}</ul>
        </div>,
      ];
    }

    // 无分类：扁平回退
    const header = this.renderHeader(selectedSlugs);
    const flat = sortTags(visible.slice());
    return [
      header,
      <div className="Modal-footer">
        <div className="lbtc-tf-GroupBody">
          {flat.map((t) => TagChip(t, {
            selected: selectedSet.has(t.slug()!),
            onclick: () => this.toggleSelect(t.slug()!),
          }))}
        </div>
      </div>,
    ];
  }

  private renderHeader(selectedSlugs: string[], expandAll?: () => void, collapseAll?: () => void) {
    const clearAll = () => {
      const q = getCurrentQ();
      const cleared = stringifyQ(clearTagsInQ(q));
      this.navigateWithQ(cleared);
    };

    // ★ 根据 slug 还原已选 Tag 实体（用于彩色芯片反馈）
    const bySlug = new Map(this.allTags.map((t) => [t.slug()!, t]));
    const selectedTags = selectedSlugs
      .map((s) => bySlug.get(s))
      .filter(Boolean) as import('flarum/tags/common/models/Tag').default[];

    return (
      <div className="Modal-body">
        <div className="Form">
          {/* 搜索框 */}
          <div className="Form-group">
            <input
              className="FormControl"
              placeholder={app.translator.trans('lady-byron-tag-filter.forum.toolbar.placeholder')}
              bidi={this.filter}
            />
          </div>

          {/* 工具按钮区 */}
          <div className="Form-group">
            <Button type="button" className="Button" icon="fas fa-eraser" onclick={clearAll} disabled={!selectedSlugs.length}>
              {app.translator.trans('lady-byron-tag-filter.forum.toolbar.clear')}
            </Button>
            {expandAll && collapseAll ? (
              <>
                <Button type="button" className="Button" style={{ marginLeft: '8px' }} onclick={expandAll}>
                  {app.translator.trans('lady-byron-tag-filter.forum.toolbar.expand_all')}
                </Button>
                <Button type="button" className="Button" style={{ marginLeft: '8px' }} onclick={collapseAll}>
                  {app.translator.trans('lady-byron-tag-filter.forum.toolbar.collapse_all')}
                </Button>
              </>
            ) : null}
          </div>

          {/* ★ 已选择标签反馈区：有则显示芯片，可点击移除；无则显示提示 */}
          <div className="Form-group">
            {selectedTags.length ? (
              <div className="lbtc-tf-GroupBody">
                {selectedTags.map((t) =>
                  // 复用 TagChip，保持原有“彩色+图标+紧密”外观
                  TagChip(t, {
                    selected: true,
                    onclick: () => this.toggleSelect(t.slug()!), // 点击即移除该 tag
                  })
                )}
              </div>
            ) : (
              <div className="HelpText">
                {app.translator.trans('lady-byron-tag-filter.forum.toolbar.hint')}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  private toggle(key: string) {
    this.collapsed[key] = !this.collapsed[key];
    saveCollapsed(this.collapsed);
    m.redraw();
  }

  private toggleSelect(slug: string) {
    const q = getCurrentQ();
    const { rest, tagSlugs } = parseQ(q);
    const next = toggleTagSlug(rest, tagSlugs, slug);
    this.navigateWithQ(stringifyQ(next));
  }

  private navigateWithQ(q: string) {
    // 跳到首页并携带 q
    m.route.set(app.route('index', q ? { q } : {}));
    this.hide();
  }
}
