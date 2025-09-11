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
import { ensureCategoryTagsLoaded } from '../util/tags';

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
    this.collapsed = loadCollapsed();
    await ensureCategoryTagsLoaded();            // 仅在需要时请求
    this.allTags = app.store.all<Tag>('tags');
    this.loading = false;
  }

  onsubmit(e: SubmitEvent) { e.preventDefault(); } // 防止 <form> 提交

  private toggleCollapsed(key: string) {
    this.collapsed[key] = !this.collapsed[key];
    saveCollapsed(this.collapsed);
    m.redraw.sync();                               // ★ 关键：同步重绘，避免与关闭动画竞态
  }

  content() {
    if (this.loading) {
      return <div className="Modal-body"><LoadingIndicator /></div>;
    }

    const { tagSlugs: selectedSlugs } = parseQ(getCurrentQ());
    const selectedSet = new Set(selectedSlugs);
    const keyword = (this.filter() || '').trim().toLowerCase();
    const visible = keyword
      ? this.allTags.filter((t) => (`${t.name()} ${t.description() || ''}`).toLowerCase().includes(keyword))
      : this.allTags.slice();

    const cats = getCategories();

    // 用单一根节点包裹全部内容，降低动画阶段 DOM 替换风险
    return (
      <div className="lbtc-tf-Content">
        {this.renderHeader(selectedSlugs,
          cats.length ? () => {
            cats.forEach((g) => (this.collapsed[String(g.id)] = false));
            this.collapsed.__ungrouped__ = false;
            saveCollapsed(this.collapsed);
            m.redraw.sync();                       // ★ 同步重绘
          } : undefined,
          cats.length ? () => {
            cats.forEach((g) => (this.collapsed[String(g.id)] = true));
            this.collapsed.__ungrouped__ = true;
            saveCollapsed(this.collapsed);
            m.redraw.sync();                       // ★ 同步重绘
          } : undefined
        )}

        <div className="Modal-footer">
          {cats.length ? this.renderGrouped(visible, selectedSet) : this.renderFlat(visible, selectedSet)}
        </div>
      </div>
    );
  }

  private renderGrouped(visible: Tag[], selectedSet: Set<string>) {
    const cats = getCategories();
    const { grouped, ungrouped } = pickTagsInCategories(visible, cats);

    if (!this.initialized) {
      cats.forEach((g) => (this.collapsed[String(g.id)] ??= true));
      if (ungrouped.length) this.collapsed.__ungrouped__ ??= true;
      this.initialized = true;
      saveCollapsed(this.collapsed);
    }

    const sections: Mithril.Children[] = [];

    grouped.forEach(({ group, tags }) => {
      const key = String(group.id);
      const isCollapsed = !!this.collapsed[key];
      const sorted = sortTags(tags.slice());

      sections.push(
        <li
          key={`h-${key}`}
          className={classList('lbtc-tf-GroupHeader', { collapsed: isCollapsed })}
          role="button"
          aria-expanded={!isCollapsed}
          tabindex="0"
          onclick={() => this.toggleCollapsed(key)}
          onkeydown={(e: KeyboardEvent) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), this.toggleCollapsed(key))}
        >
          <i className="fas fa-chevron-down lbtc-tf-GroupHeader-caret" />
          {group.name}
        </li>
      );

      if (!isCollapsed) {
        sections.push(
          <li key={`b-${key}`} className="lbtc-tf-GroupBody">
            {sorted.map((t) =>
              TagChip(t, {
                selected: selectedSet.has(t.slug()!),
                onclick: () => this.toggleSelect(t.slug()!),
              })
            )}
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
          key="h-__ungrouped__"
          className={classList('lbtc-tf-GroupHeader', { collapsed: isCollapsed })}
          role="button"
          aria-expanded={!isCollapsed}
          tabindex="0"
          onclick={() => this.toggleCollapsed(key)}
          onkeydown={(e: KeyboardEvent) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), this.toggleCollapsed(key))}
        >
          <i className="fas fa-chevron-down lbtc-tf-GroupHeader-caret" />
          {app.translator.trans('lady-byron-tag-filter.forum.grouped.ungrouped')}
        </li>
      );

      if (!isCollapsed) {
        sections.push(
          <li key="b-__ungrouped__" className="lbtc-tf-GroupBody">
            {sorted.map((t) =>
              TagChip(t, {
                selected: selectedSet.has(t.slug()!),
                onclick: () => this.toggleSelect(t.slug()!),
              })
            )}
          </li>
        );
      }
    }

    return <ul className="lbtc-tf-GroupList">{sections}</ul>;
  }

  private renderFlat(visible: Tag[], selectedSet: Set<string>) {
    const flat = sortTags(visible.slice());
    return (
      <div className="lbtc-tf-GroupBody">
        {flat.map((t) =>
          TagChip(t, {
            selected: selectedSet.has(t.slug()!),
            onclick: () => this.toggleSelect(t.slug()!),
          })
        )}
      </div>
    );
  }

  private renderHeader(selectedSlugs: string[], expandAll?: () => void, collapseAll?: () => void) {
    const clearAll = () => {
      const q = getCurrentQ();
      const cleared = stringifyQ(clearTagsInQ(q));
      this.navigateWithQ(cleared);
    };

    const bySlug = new Map(this.allTags.map((t) => [t.slug()!, t]));
    const selectedTags = selectedSlugs.map((s) => bySlug.get(s)).filter(Boolean) as Tag[];

    return (
      <div className="Modal-body">
        <div className="Form">
          <div className="Form-group">
            <input
              className="FormControl"
              placeholder={app.translator.trans('lady-byron-tag-filter.forum.toolbar.placeholder')}
              bidi={this.filter}
            />
          </div>
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

          <div className="Form-group">
            {selectedTags.length ? (
              <div className="lbtc-tf-GroupBody">
                {selectedTags.map((t) =>
                  TagChip(t, { selected: true, onclick: () => this.toggleSelect(t.slug()!) })
                )}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  private toggleSelect(slug: string) {
    const q = getCurrentQ();
    const { rest, tagSlugs } = parseQ(q);
    const next = toggleTagSlug(rest, tagSlugs, slug);
    this.navigateWithQ(stringifyQ(next));
  }

  private navigateWithQ(q: string) {
    // 先改路由，再交给 ModalManager 关闭；不做额外 redraw
    m.route.set(app.route('index', q ? { q } : {}));
    this.hide();
  }
}
