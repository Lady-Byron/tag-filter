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

  // 防止 guard 重入
  private guardPending = false;

  // —— 仅为修复 X 偶发无法关闭：全局捕获点击矫正 —— //
  private teardownCloseHack?: () => void;

  className() {
    return 'lbtc-tf-Modal Modal--large';
  }

  title() {
    return app.translator.trans('lady-byron-tag-filter.forum.toolbar.button');
  }

  async oninit(vnode: Vnode) {
    super.oninit(vnode);
    this.collapsed = loadCollapsed();

    await ensureCategoryTagsLoaded();
    this.allTags = app.store.all<Tag>('tags');
    this.loading = false;
  }

  // 表单提交一律视为“关闭”以规避 submit 干扰（保留原策略）
  onsubmit(e: SubmitEvent) {
    e.preventDefault();
    this.hide();
  }

  oncreate(vnode: Mithril.VnodeDOM) {
    super.oncreate(vnode);
    this.ensureCloseWorking();
  }

  onupdate(vnode: Mithril.VnodeDOM) {
    // @ts-ignore 可选调用
    super.onupdate?.(vnode);
    this.ensureCloseWorking();
  }

  onremove() {
    // 清理全局捕获监听
    this.teardownCloseHack?.();
    this.teardownCloseHack = undefined;
    // @ts-ignore
    super.onremove?.();
  }

  /**
   * 让右上角 X 在任何情况下都能关闭：
   * 1) 若是 <button>，强制设为 type="button"，并绑定一次性点击直接 hide()
   * 2) 安装 document 级捕获监听：只要点击点落在 X 的矩形区域内，就强制 hide()
   */
  private ensureCloseWorking() {
    const root = this.element as HTMLElement | null;
    if (!root) return;

    const closeEl = root.querySelector('.Modal-close') as HTMLElement | null;
    if (!closeEl) return;

    // (1) 按钮型的基础修正
    if (closeEl.tagName === 'BUTTON') {
      const btn = closeEl as HTMLButtonElement;
      if (btn.getAttribute('type') !== 'button') btn.setAttribute('type', 'button');
      btn.setAttribute('formnovalidate', 'true');

      // 仅绑定一次（放在捕获阶段，优先触发）
      // @ts-ignore
      if (!btn._lbFixed) {
        // @ts-ignore
        btn._lbFixed = true;
        btn.addEventListener(
          'click',
          (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.hide();
          },
          { capture: true }
        );
      }
    } else {
      // 若不是 <button>（如 <a> / <div>），也补一个直接关闭的监听
      // @ts-ignore
      if (!closeEl._lbFixed) {
        // @ts-ignore
        closeEl._lbFixed = true;
        closeEl.addEventListener(
          'click',
          (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.hide();
          },
          { capture: true }
        );
      }
    }

    // (2) 全局捕获“矩形命中”矫正（解决透明覆盖/层叠遮挡导致点不到 X 的情况）
    if (!this.teardownCloseHack) {
      const handler = (e: MouseEvent) => {
        // 若节点已不在文档中则忽略
        if (!document.body.contains(closeEl)) return;

        const rect = closeEl.getBoundingClientRect();
        const { clientX: x, clientY: y } = e;

        const hit =
          x >= rect.left &&
          x <= rect.right &&
          y >= rect.top &&
          y <= rect.bottom;

        if (hit) {
          e.preventDefault();
          e.stopPropagation();
          this.hide();
        }
      };

      document.addEventListener('click', handler, true);
      this.teardownCloseHack = () => document.removeEventListener('click', handler, true);
    }
  }

  private guardEnsureLoaded(): boolean {
    const cats = getCategories();
    if (!cats.length) return true;

    const have = new Set(this.allTags.map((t) => String(t.id())));
    let missing = false;
    for (const g of cats) {
      for (const id of g.tagIds || []) {
        if (!have.has(String(id))) {
          missing = true;
          break;
        }
      }
      if (missing) break;
    }
    if (!missing) return true;

    if (!this.guardPending) {
      this.guardPending = true;
      this.loading = true;
      warmupTags()
        .catch(() => {})
        .finally(() => {
          this.allTags = app.store.all<Tag>('tags');
          this.loading = false;
          this.guardPending = false;
          m.redraw();
        });
    }
    return false;
  }

  content() {
    if (this.loading) {
      return <div className="Modal-body"><LoadingIndicator /></div>;
    }
    if (!this.guardEnsureLoaded()) {
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
            <li className="lbtc-tf-GroupBody">
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
            <li className="lbtc-tf-GroupBody">
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

      return [
        header,
        <div className="Modal-footer">
          <ul className="lbtc-tf-GroupList">{sections}</ul>
        </div>,
      ];
    }

    const header = this.renderHeader(selectedSlugs);
    const flat = sortTags(visible.slice());
    return [
      header,
      <div className="Modal-footer">
        <div className="lbtc-tf-GroupBody">
          {flat.map((t) =>
            TagChip(t, {
              selected: selectedSet.has(t.slug()!),
              onclick: () => this.toggleSelect(t.slug()!),
            })
          )}
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
            <Button
              type="button"
              className="Button"
              icon="fas fa-eraser"
              onclick={clearAll}
              disabled={!selectedSlugs.length}
            >
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

          {/* 已选择标签反馈（彩色芯片，点击可移除；描述在 CSS 中隐藏） */}
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
