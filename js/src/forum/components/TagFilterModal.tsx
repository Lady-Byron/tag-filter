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
import { ensureCategoryTagsLoaded, warmupTags } from '../util/tags';  // ★ 新增

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
    // ★ 仅在缺少“分类里需要的标签”时才请求；否则即用缓存
    await ensureCategoryTagsLoaded();
    this.allTags = app.store.all<Tag>('tags');
    this.loading = false;
  }

  onsubmit(e: SubmitEvent) { e.preventDefault(); }

  /** 若渲染时仍发现缺失（理论上极少），补拉并转入 Loading */
  private async guardEnsureLoaded() {
    const cats = getCategories();
    if (!cats.length) return true;

    const need = new Set<string>();
    cats.forEach((g) => (g.tagIds || []).forEach((id) => need.add(String(id))));
    const have = new Set(this.allTags.map((t) => String(t.id())));
    const missing = [...need].some((id) => !have.has(id));
    if (!missing) return true;

    this.loading = true;
    await warmupTags();
    this.allTags = app.store.all<Tag>('tags');
    this.loading = false;
    return true;
  }

  content() {
    if (this.loading) return <div className="Modal-body"><LoadingIndicator /></div>;
    // 极端兜底
    if (!this.guardEnsureLoaded()) return <div className="Modal-body"><LoadingIndicator /></div>;

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

    // —— 无分组：扁平回退 ——
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
    m.route.set(app.route('index', q ? { q } : {}));
    this.hide();
  }
}
