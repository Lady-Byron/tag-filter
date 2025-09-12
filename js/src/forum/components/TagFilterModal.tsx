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
  static isDismissibleViaEscKey = true;
  static isDismissibleViaBackdropClick = true;
  static isDismissibleViaCloseButton = true;

  private allTags: Tag[] = [];
  private filter = Stream<string>('');
  private collapsed: Record<string, boolean> = {};
  private initialized = false;

  // ★ 新增：路由更新防抖定时器（连续点选时只跳一次）
  private navTimer: number | null = null;

  className() { return 'lbtc-tf-Modal Modal--large'; }
  title() { return app.translator.trans('lady-byron-tag-filter.forum.toolbar.button'); }

  oninit(vnode: Vnode) {
    super.oninit(vnode);
    this.collapsed = loadCollapsed();
    this.allTags = app.store.all<Tag>('tags');
  }

  oncreate(vnode: Mithril.VnodeDOM) {
    super.oncreate(vnode);
    // 确保 X 是按钮并直连全局关闭
    const closeBtn = this.element?.querySelector<HTMLButtonElement>('.Modal-close');
    if (closeBtn) {
      if (!closeBtn.getAttribute('type')) closeBtn.setAttribute('type', 'button');
      closeBtn.onclick = () => app.modal.close();
    }
  }

  onremove() {
    if (this.navTimer) { clearTimeout(this.navTimer); this.navTimer = null; }
  }

  onsubmit(e: SubmitEvent) { e.preventDefault(); }

  content() {
    if (!this.allTags.length) {
      return <div className="Modal-body"><LoadingIndicator /></div>;
    }

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
            key={`g-${key}-header`}
            className={classList('lbtc-tf-GroupHeader', { collapsed: isCollapsed })}
            role="button"
            aria-expanded={!isCollapsed}
            tabindex="0"
            onclick={() => this.toggle(key)}
            onkeydown={(e: KeyboardEvent) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), this.toggle(key))}
          >
            <i className="fas fa-chevron-down lbtc-tf-GroupHeader-caret" />
            {group.name}
          </li>
        );

        if (!isCollapsed) {
          sections.push(
            <li key={`g-${key}-body`} className="lbtc-tf-GroupBody">
              {sorted.map((t) => (
                <span key={`t-${t.id()}`} style={{ display: 'contents' }}>
                  {TagChip(t, {
                    selected: selectedSet.has(t.slug()!),
                    onclick: () => this.toggleSelect(t.slug()!), // ★ 不关闭，仅更新路由（防抖）
                  })}
                </span>
              ))}
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
            key={`g-${key}-header`}
            className={classList('lbtc-tf-GroupHeader', { collapsed: isCollapsed })}
            role="button"
            aria-expanded={!isCollapsed}
            tabindex="0"
            onclick={() => this.toggle(key)}
            onkeydown={(e: KeyboardEvent) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), this.toggle(key))}
          >
            <i className="fas fa-chevron-down lbtc-tf-GroupHeader-caret" />
            {app.translator.trans('lady-byron-tag-filter.forum.grouped.ungrouped')}
          </li>
        );

        if (!isCollapsed) {
          sections.push(
            <li key={`g-${key}-body`} className="lbtc-tf-GroupBody">
              {sorted.map((t) => (
                <span key={`t-${t.id()}`} style={{ display: 'contents' }}>
                  {TagChip(t, {
                    selected: selectedSet.has(t.slug()!),
                    onclick: () => this.toggleSelect(t.slug()!),
                  })}
                </span>
              ))}
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

    // —— 无分组回退 ——
    const header = this.renderHeader(selectedSlugs);
    const flat = sortTags(visible.slice());
    return [
      header,
      <div className="Modal-footer">
        <div className="lbtc-tf-GroupBody">
          {flat.map((t) => (
            <span key={`flat-${t.id()}`} style={{ display: 'contents' }}>
              {TagChip(t, {
                selected: selectedSet.has(t.slug()!),
                onclick: () => this.toggleSelect(t.slug()!),
              })}
            </span>
          ))}
        </div>
      </div>,
    ];
  }

  private renderHeader(selectedSlugs: string[], expandAll?: () => void, collapseAll?: () => void) {
    const clearAll = () => {
      const q = getCurrentQ();
      const cleared = stringifyQ(clearTagsInQ(q));
      this.navigateWithQ(cleared, { close: false }); // ★ 清空后保持弹窗打开
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
            {/* ★ 新增：完成（仅关闭弹窗，不改变当前筛选） */}
            <Button
              type="button"
              className="Button Button--primary"
              style={{ marginLeft: '8px' }}
              onclick={() => app.modal.close()}
            >
              {app.translator.trans('lady-byron-tag-filter.forum.toolbar.done')}
            </Button>
          </div>

          {/* 已选标签反馈 */}
          <div className="Form-group">
            {selectedTags.length ? (
              <div className="lbtc-tf-GroupBody">
                {selectedTags.map((t) =>
                  <span key={`sel-${t.id()}`} style={{ display: 'contents' }}>
                    {TagChip(t, { selected: true, onclick: () => this.toggleSelect(t.slug()!) })}
                  </span>
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
    this.navigateWithQ(stringifyQ(next), { close: false }); // ★ 不自动关闭
  }

  /** 统一的导航：防抖更新 ?q=...；可选择是否关闭 */
  private navigateWithQ(q: string, opts: { close?: boolean; debounce?: number; replace?: boolean } = {}) {
    const debounce = opts.debounce ?? 250;
    const replace = opts.replace ?? true;

    if (this.navTimer) clearTimeout(this.navTimer);
    this.navTimer = window.setTimeout(() => {
      this.navTimer = null;
      const params = m.route.param();
      if (q) params.q = q; else delete params.q;
      // Mithril 支持 replace 选项，避免历史栈被频繁点选刷满
      const url = app.route('index', params);
      // @ts-ignore
      m.route.set(url, undefined, replace ? { replace: true } : undefined);

      if (opts.close) app.modal.close();
      else m.redraw(); // 让“已选标签”区即时更新
    }, debounce);
  }

  /** 不再在这里关闭弹窗；关闭交给 X / 完成按钮 */
  // private navigateWithQ(q: string) { ... 旧实现已移除 ... }
}
