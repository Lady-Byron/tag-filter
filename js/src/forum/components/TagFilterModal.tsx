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
import { ensureCategoryTagsLoaded, warmupTags } from '../util/tags';

type Vnode = Mithril.Vnode<Record<string, never>, TagFilterModal>;

export default class TagFilterModal extends Modal {
  private loading = true;
  private allTags: Tag[] = [];
  private filter = Stream<string>('');
  private collapsed: Record<string, boolean> = {};
  private initialized = false;

  // 关闭按钮的兜底监听（用于 onremove 清理）
  private closeHandler?: (e: Event) => void;
  private guardPending = false;

  className() { return 'lbtc-tf-Modal Modal--large'; }
  title() { return app.translator.trans('lady-byron-tag-filter.forum.toolbar.button'); }

  async oninit(vnode: Vnode) {
    super.oninit(vnode);
    this.collapsed = loadCollapsed();
    await ensureCategoryTagsLoaded();             // 只在缺时请求
    this.allTags = app.store.all<Tag>('tags');
    this.loading = false;
  }

  // ★ 表单提交一律视为关闭，避免“提交阻断关闭”的情况
  onsubmit(e: SubmitEvent) {
    e.preventDefault();
    this.hide();
  }

  // ★ 强制把右上角 X 设为非提交按钮，并额外绑定一次性关闭监听
  oncreate(vnode: Mithril.VnodeDOM) {
    super.oncreate(vnode);
    const closeBtn = this.element?.querySelector<HTMLButtonElement>('.Modal-close');
    if (closeBtn) {
      if (!closeBtn.getAttribute('type')) closeBtn.setAttribute('type', 'button');
      this.closeHandler = (ev: Event) => {
        ev.preventDefault();
        ev.stopPropagation();
        this.hide();
      };
      closeBtn.addEventListener('click', this.closeHandler, { capture: true });
    }
  }

  onremove() {
    // 清理监听，避免下次打开重复绑定
    const closeBtn = this.element?.querySelector<HTMLButtonElement>('.Modal-close');
    if (closeBtn && this.closeHandler) {
      closeBtn.removeEventListener('click', this.closeHandler, { capture: true } as any);
    }
    this.closeHandler = undefined;
  }

  /** 渲染前兜底：若分类中的 tag 仍未载入，则后台加载并暂时显示 Loading */
  private guardEnsureLoaded(): boolean {
    const cats = getCategories();
    if (!cats.length) return true;

    const have = new Set(this.allTags.map((t) => String(t.id())));
    let missing = false;
    for (const g of cats) {
      for (const id of g.tagIds || []) {
        if (!have.has(String(id))) { missing = true; break; }
      }
      if (missing) break;
    }
    if (!missing) return true;

    if (!this.guardPending) {
      this.guardPending = true;
      this.loading = true;
      warmupTags().catch(() => {}).finally(() => {
        this.allTags = app.store.all<Tag>('tags');
        this.loading = false;
        this.guardPending = false;
        m.redraw();
      });
    }
    return false;
  }

  content() {
    if (this.loading) return <div className="Modal-body"><LoadingIndicator /></div>;
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

      const expandAll = () => {
        cats.forEach((g) => (this.collapsed[String(g.id)] = false));
        this.collapsed.__ungrouped__ = false;
        saveCollapsed(this.collapsed);
        m.redraw();
      };
      const collapseAll = () => {
        cats.forEach((g) => (this.collapsed[String(g.id)] = true));
        this.collapsed.__ungrouped__ = true;
        saveCollapsed(this.collapsed);
        m.redraw();
      };

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
            onkeydown={(e: KeyboardEvent) =>
              (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), this.toggle(key))}
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
            onkeydown={(e: KeyboardEvent) =>
              (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), this.toggle(key))}
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

          {/* 已选择标签反馈（彩色芯片；描述在 CSS 隐藏；点击可移除） */}
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
