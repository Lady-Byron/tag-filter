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

  className() {
    return 'lbtc-tf-Modal Modal--large';
  }

  title() {
    return app.translator.trans('lady-byron-tag-filter.forum.toolbar.button');
  }

  oninit(vnode: Vnode) {
    super.oninit(vnode);
    this.collapsed = loadCollapsed();
    this.allTags = app.store.all<Tag>('tags');
  }

  oncreate(vnode: Mithril.VnodeDOM) {
    super.oncreate(vnode);
    // 只把右上角 X 设为非提交按钮，避免 submit；不改 onclick，避免 double-close
    const closeBtn = this.element?.querySelector<HTMLButtonElement>('.Modal-close');
    if (closeBtn && !closeBtn.getAttribute('type')) {
      closeBtn.setAttribute('type', 'button');
    }
  }

  onsubmit(e: SubmitEvent) {
    e.preventDefault();
  }

  content() {
    if (!this.allTags.length) {
      return (
        <div className="Modal-body">
          <LoadingIndicator />
        </div>
      );
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

      // 已分组
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
            onkeydown={(e: KeyboardEvent) =>
              (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), this.toggle(key))
            }
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
                    // 多选：实时刷新，不关闭弹窗
                    onclick: () => this.toggleSelect(t.slug()!, true),
                  })}
                </span>
              ))}
            </li>
          );
        }
      });

      // 未分组
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
            onkeydown={(e: KeyboardEvent) =>
              (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), this.toggle(key))
            }
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
                    onclick: () => this.toggleSelect(t.slug()!, true),
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

    // 无分组回退：扁平列表
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
                onclick: () => this.toggleSelect(t.slug()!, true),
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
      // 清空后保持弹窗打开，仅刷新结果
      this.navigateWithQ(cleared, { close: false, replace: true });
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
            <Button
              type="button"
              className="Button"
              icon="fa-solid fa-eraser"
              onclick={clearAll}
              disabled={!selectedSlugs.length}
            >
              {app.translator.trans('lady-byron-tag-filter.forum.toolbar.clear')}
            </Button>

            {expandAll && collapseAll ? (
              <>
                <Button
                  type="button"
                  className="Button"
                  style={{ marginLeft: '8px' }}
                  icon="fa-solid fa-angles-down"
                  onclick={expandAll}
                >
                  {app.translator.trans('lady-byron-tag-filter.forum.toolbar.expand_all')}
                </Button>
                <Button
                  type="button"
                  className="Button"
                  style={{ marginLeft: '8px' }}
                  icon="fa-solid fa-angles-up"
                  onclick={collapseAll}
                >
                  {app.translator.trans('lady-byron-tag-filter.forum.toolbar.collapse_all')}
                </Button>
              </>
            ) : null}
          </div>

          <div className="Form-group">
            {selectedTags.length ? (
              <div className="lbtc-tf-GroupBody">
                {selectedTags.map((t) => (
                  <span key={`sel-${t.id()}`} style={{ display: 'contents' }}>
                    {TagChip(t, {
                      selected: true,
                      onclick: () => this.toggleSelect(t.slug()!, true),
                    })}
                  </span>
                ))}
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

  // keepOpen = true：只刷新结果，不关闭弹窗
  private toggleSelect(slug: string, keepOpen = false) {
    const q = getCurrentQ();
    const { rest, tagSlugs } = parseQ(q);
    const next = toggleTagSlug(rest, tagSlugs, slug);
    this.navigateWithQ(stringifyQ(next), { close: !keepOpen, replace: true });
  }

  /**
   * 更新 q，并显式刷新讨论列表。
   * 关键点：直接把我们拼出来的“空格版 q”喂给 discussions.refreshParams，
   * 避免再从 URL 读回带 '+' 的版本。
   */
  private navigateWithQ(q: string, opts: { close?: boolean; replace?: boolean } = {}) {
    const { close = false, replace = true } = opts;

    // 我们自己生成的 q 已经是 "tag:foo tag:bar" 形式，不做额外 '+' 处理
    const normalizedQ = q || '';

    if (close) {
      app.modal?.close?.();
    }

    requestAnimationFrame(() => {
      const dl: any = (app as any).discussions;

      // 以现有参数为基础，替换 q（保留 sort / author 等）
      let params: any =
        dl && typeof dl.getParams === 'function'
          ? { ...dl.getParams() }
          : { ...m.route.param() };

      if (normalizedQ) {
        params.q = normalizedQ;
      } else {
        delete params.q;
      }

      // 显式刷新列表，确保 filter[q] 用的是空格版 q
      if (dl && typeof dl.refreshParams === 'function') {
        dl.refreshParams(params, 1);
      }

      // 同步搜索框显示（可选）
      if ((app.search as any)?.setValue) {
        (app.search as any).setValue(normalizedQ);
      }

      // 同步 URL（浏览器会把空格编码成 '+'，但我们之后不再从 URL 反向解析）
      m.route.set(app.route('index', normalizedQ ? { q: normalizedQ } : {}), undefined as any, {
        replace,
      } as any);
    });
  }
}

