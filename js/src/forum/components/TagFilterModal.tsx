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
  // 自己的加载态，避免和基类混淆
  private tfLoading = true;

  private allTags: Tag[] = [];
  private filter = Stream<string>('');
  private collapsed: Record<string, boolean> = {};
  private initialized = false;

  // 防止 guard 重入
  private guardPending = false;

  // —— 可关闭兜底钩子 —— //
  private removeDismissHandlers?: () => void;

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
    this.tfLoading = false;
  }

  // 弹窗已显示且可交互时，确保基类非“加载中”态
  onready() {
    // @ts-ignore 可选调用
    super.onready?.();
    // 基类提供的 loaded() 会明确允许关闭（不同版本保持兼容）
    this.loaded?.();
  }

  // 表单提交一律视为“关闭”以规避 submit 干扰
  onsubmit(e: SubmitEvent) {
    e.preventDefault();
    this.hide();
  }

  oncreate(vnode: Mithril.VnodeDOM) {
    super.oncreate(vnode);
    this.installDismissFallbacks();
  }

  onupdate(vnode: Mithril.VnodeDOM) {
    // @ts-ignore
    super.onupdate?.(vnode);
    this.installDismissFallbacks();
  }

  onremove(vnode: Mithril.VnodeDOM) {
    // @ts-ignore
    super.onremove?.(vnode);
    this.removeDismissHandlers?.();
    this.removeDismissHandlers = undefined;
  }

  /**
   * 兜底可关闭机制（只做这件事，不改你的其它逻辑）：
   * - 捕获阶段监听 Esc：直接关闭
   * - 捕获阶段监听遮罩点击（#Modal 根元素）：直接关闭
   * - 确保右上角 X 永远可点（type="button"，移除 disabled）
   * 说明：ModalManager 使用 MicroModal 管理遮罩/Esc，若其监听被子层级拦截，这里强制兜底。:contentReference[oaicite:2]{index=2}
   */
  private installDismissFallbacks() {
    const rootEl = document.getElementById('Modal'); // ModalManager 根节点
    const closeBtn = this.element?.querySelector<HTMLButtonElement>('.Modal-close');

    // 1) X 按钮永远可点击
    if (closeBtn) {
      if (closeBtn.getAttribute('type') !== 'button') closeBtn.setAttribute('type', 'button');
      closeBtn.removeAttribute('disabled');
      closeBtn.removeAttribute('aria-disabled');
      // 只绑定一次，捕获阶段保证最高优先级
      // @ts-ignore
      if (!closeBtn._lbtcBound) {
        // @ts-ignore
        closeBtn._lbtcBound = true;
        closeBtn.addEventListener(
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

    // 2) Esc & 遮罩点击兜底（捕获阶段）
    if (!this.removeDismissHandlers) {
      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape' || e.key === 'Esc') {
          e.stopPropagation();
          e.preventDefault();
          this.hide(); // 等价于 app.modal.close() :contentReference[oaicite:3]{index=3}
        }
      };

      const onBackdrop = (e: MouseEvent) => {
        if (!rootEl) return;
        // 只在点击到遮罩根元素本身时触发（避免误伤内容区）
        if (e.target === rootEl) {
          e.stopPropagation();
          e.preventDefault();
          this.hide();
        }
      };

      window.addEventListener('keydown', onKey, true);
      rootEl?.addEventListener('click', onBackdrop, true);

      this.removeDismissHandlers = () => {
        window.removeEventListener('keydown', onKey, true);
        rootEl?.removeEventListener('click', onBackdrop, true);
      };
    }
  }

  /**
   * 渲染前兜底：若分类里某些 tagId 仍未载入，则后台补拉，拉完重绘
   */
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
      this.tfLoading = true;
      warmupTags()
        .catch(() => {})
        .finally(() => {
          this.allTags = app.store.all<Tag>('tags');
          this.tfLoading = false;
          this.guardPending = false;
          m.redraw();
        });
    }
    return false;
  }

  content() {
    if (this.tfLoading) {
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

      // 已分组
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

      // 未分组
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

    // —— 无分组：扁平回退 ——
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
