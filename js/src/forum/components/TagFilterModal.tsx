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
import { getCurrentQ, parseQ, stringifyQ } from '../util/query';

type Vnode = Mithril.Vnode<Record<string, never>, TagFilterModal>;

export default class TagFilterModal extends Modal {
  static isDismissibleViaEscKey = true;
  static isDismissibleViaBackdropClick = true;
  static isDismissibleViaCloseButton = true;

  private allTags: Tag[] = [];
  private filter = Stream<string>('');
  private collapsed: Record<string, boolean> = {};
  private initialized = false;

  // 本地选择集（实时应用，不关闭弹窗）
  private localSelected = new Set<string>();
  // 打开时保留的其它关键词（非 tag: 片段）
  private initialRest = '';

  // 防抖：频繁点击时合并更新
  private applyTimer: number | null = null;

  className() { return 'lbtc-tf-Modal Modal--large'; }
  title() { return app.translator.trans('lady-byron-tag-filter.forum.toolbar.button'); }

  oninit(vnode: Vnode) {
    super.oninit(vnode);
    this.collapsed = loadCollapsed();
    this.allTags = app.store.all<Tag>('tags');

    const { rest, tagSlugs } = parseQ(getCurrentQ());
    this.initialRest = rest;
    this.localSelected = new Set(tagSlugs);
  }

  oncreate(vnode: Mithril.VnodeDOM) {
    super.oncreate(vnode);
    // 保证 X 为按钮并直连关闭
    const closeBtn = this.element?.querySelector<HTMLButtonElement>('.Modal-close');
    if (closeBtn) {
      if (!closeBtn.getAttribute('type')) closeBtn.setAttribute('type', 'button');
      closeBtn.onclick = () => app.modal.close();
    }
  }

  onremove() {
    if (this.applyTimer) { clearTimeout(this.applyTimer); this.applyTimer = null; }
  }

  onsubmit(e: SubmitEvent) { e.preventDefault(); }

  content() {
    if (!this.allTags.length) return <div className="Modal-body"><LoadingIndicator /></div>;

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

      const header = this.renderHeader(expandAll, collapseAll);
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
            onclick={() => this.toggleGroup(key)}
            onkeydown={(e: KeyboardEvent) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), this.toggleGroup(key))}
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
                    selected: this.localSelected.has(t.slug()!),
                    onclick: () => this.toggleLocalAndApply(t.slug()!), // ★ 实时应用，不关闭
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
            onclick={() => this.toggleGroup(key)}
            onkeydown={(e: KeyboardEvent) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), this.toggleGroup(key))}
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
                    selected: this.localSelected.has(t.slug()!),
                    onclick: () => this.toggleLocalAndApply(t.slug()!),
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
    const header = this.renderHeader();
    const flat = sortTags(visible.slice());
    return [
      header,
      <div className="Modal-footer">
        <div className="lbtc-tf-GroupBody">
          {flat.map((t) => (
            <span key={`flat-${t.id()}`} style={{ display: 'contents' }}>
              {TagChip(t, {
                selected: this.localSelected.has(t.slug()!),
                onclick: () => this.toggleLocalAndApply(t.slug()!),
              })}
            </span>
          ))}
        </div>
      </div>,
    ];
  }

  /** 头部：搜索框 + 控制按钮 + 已选反馈（基于 localSelected） */
  private renderHeader(expandAll?: () => void, collapseAll?: () => void) {
    const clearLocal = () => { this.localSelected.clear(); this.applyNow({ debounce: 0 }); m.redraw(); };

    // 已选反馈
    const bySlug = new Map(this.allTags.map((t) => [t.slug()!, t]));
    const selectedTags = Array.from(this.localSelected).map((s) => bySlug.get(s)).filter(Boolean) as Tag[];

    return (
      <div className="Modal-body">
        <div className="Form">
          <div className="Form-group">
            <input
              className="FormControl"
              placeholder={app.translator.trans('lady-byron-tag-filter.forum.toolbar.placeholder')}
              bidi={this.filter}
              oninput={() => m.redraw()}
            />
          </div>
          <div className="Form-group">
            <div className="ButtonGroup">
              <Button type="button" className="Button" icon="fas fa-eraser" onclick={clearLocal} disabled={!selectedTags.length}>
                {app.translator.trans('lady-byron-tag-filter.forum.toolbar.clear')}
              </Button>
              {expandAll && collapseAll ? (
                <>
                  <Button type="button" className="Button" onclick={expandAll}>
                    {app.translator.trans('lady-byron-tag-filter.forum.toolbar.expand_all')}
                  </Button>
                  <Button type="button" className="Button" onclick={collapseAll}>
                    {app.translator.trans('lady-byron-tag-filter.forum.toolbar.collapse_all')}
                  </Button>
                </>
              ) : null}
              <Button type="button" className="Button Button--primary" onclick={() => app.modal.close()}>
                {app.translator.trans('lady-byron-tag-filter.forum.toolbar.done')}
              </Button>
            </div>
          </div>

          {/* 已选标签（点可取消） */}
          <div className="Form-group">
            {selectedTags.length ? (
              <div className="lbtc-tf-GroupBody">
                {selectedTags.map((t) =>
                  <span key={`sel-${t.id()}`} style={{ display: 'contents' }}>
                    {TagChip(t, { selected: true, onclick: () => this.toggleLocalAndApply(t.slug()!) })}
                  </span>
                )}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  private toggleGroup(key: string) {
    this.collapsed[key] = !this.collapsed[key];
    saveCollapsed(this.collapsed);
    m.redraw();
  }

  private toggleLocalAndApply(slug: string) {
    if (this.localSelected.has(slug)) this.localSelected.delete(slug);
    else this.localSelected.add(slug);
    this.applyNow(); // 实时应用
    m.redraw();
  }

  /** 核心：不跳路由，直接更新搜索状态（有则用 API，无则降级 route.replace） */
  private applyNow(opts: { debounce?: number } = {}) {
    const q = stringifyQ({ rest: this.initialRest, tagSlugs: Array.from(this.localSelected) });

    const doApply = () => {
      const s: any = (app as any).search;

      // 优先使用搜索状态 API（不会关闭弹窗）
      if (s?.updateParams) {
        s.updateParams({ q });
      } else if (s?.search) {
        // 一些版本上是 search(text)
        s.search(q);
      } else {
        // 最后兜底：用路由替换（可能会导致关闭；仅当上面 API 不存在时）
        const params = m.route.param();
        if (q) params.q = q; else delete params.q;
        const url = app.route('index', params);
        // @ts-ignore
        m.route.set(url, undefined, { replace: true });
      }
    };

    const wait = opts.debounce ?? 150;
    if (this.applyTimer) clearTimeout(this.applyTimer);
    this.applyTimer = window.setTimeout(() => {
      this.applyTimer = null;
      doApply();
    }, wait);
  }
}
