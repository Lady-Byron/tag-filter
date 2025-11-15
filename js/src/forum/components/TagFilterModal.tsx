// js/src/forum/components/TagFilterModal.tsx

import app from 'flarum/forum/app';
import Modal from 'flarum/common/components/Modal';
import Button from 'flarum/common/components/Button';
import LoadingIndicator from 'flarum/common/components/LoadingIndicator';
import Stream from 'flarum/common/utils/Stream';
import classList from 'flarum/common/utils/classList';
import sortTags from 'flarum/tags/common/utils/sortTags';
import type Tag from 'flarum/tags/common/models/Tag';
// === 新增导入：用于渲染插件A风格的“标签Chip” ===
import tagLabel from 'flarum/tags/common/helpers/tagLabel';
// ============================================

import TagChip from './TagChip';
import {
  getCategories,
  pickTagsInCategories,
  loadCollapsed,
  saveCollapsed,
} from '../util/categories';
import {
  getCurrentQ,
  parseQ,
  stringifyQ,
  toggleTagSlug, // 注意：这个在onsubmit中已不再需要，但保留也无妨
  clearTagsInQ,
} from '../util/query';
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

  // === 新增状态：用于暂存用户在弹窗中的标签选择 (slugs) ===
  private selectedSlugs!: Set<string>;
  // ==================================================

  className() {
    return 'lbtc-tf-Modal Modal--large';
  }

  title() {
    return app.translator.trans('lady-byron-tag-filter.forum.toolbar.button');
  }

  async oninit(vnode: Vnode) {
    super.oninit(vnode);
    this.collapsed = loadCollapsed();

    // === 修改点：从 URL 初始化 state ===
    const { tagSlugs } = parseQ(getCurrentQ());
    this.selectedSlugs = new Set(tagSlugs);
    // =================================

    // 仅当分类需要但缓存缺失时才请求；否则使用已有缓存
    await ensureCategoryTagsLoaded();
    this.allTags = app.store.all<Tag>('tags');
    this.loading = false;
  }

  // === 修改点：onsubmit 不再是“关闭”，而是“应用过滤” ===
  onsubmit(e: SubmitEvent) {
    e.preventDefault();

    // 获取当前的 URL (保留搜索词等非标签部分)
    const q = getCurrentQ();
    const { rest } = parseQ(q);

    // 组合非标签部分 + 新的标签 state
    const next = { rest, tagSlugs: Array.from(this.selectedSlugs) };
    const newQ = stringifyQ(next);

    // 检查查询是否真的改变了，避免无意义的刷新
    const oldQ = stringifyQ(parseQ(q));
    if (newQ !== oldQ) {
      // 执行导航
      m.route.set(app.route('index', newQ ? { q: newQ } : {}));
    }

    // 关闭弹窗
    this.hide();
  }
  // =================================================

  // 把右上角 X 强制设为非提交按钮，避免触发 submit (保持不变)
  oncreate(vnode: Mithril.VnodeDOM) {
    super.oncreate(vnode);
    const closeBtn =
      this.element?.querySelector<HTMLButtonElement>('.Modal-close');
    if (closeBtn && !closeBtn.getAttribute('type')) {
      closeBtn.setAttribute('type', 'button');
    }
  }

  /**
   * 渲染前兜底 (保持不变)
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
      return (
        <div className="Modal-body">
          <LoadingIndicator />
        </div>
      );
    }

    // 若仍缺失，先显示 Loading (保持不变)
    if (!this.guardEnsureLoaded()) {
      return (
        <div className="Modal-body">
          <LoadingIndicator />
        </div>
      );
    }

    // === 修改点：数据源改为内部 state ===
    // const { tagSlugs: selectedSlugs } = parseQ(getCurrentQ()); <== 移除
    // const selectedSet = new Set(selectedSlugs); <== 移除
    const selectedSet = this.selectedSlugs; // <== 使用内部 state
    // ===================================

    const keyword = (this.filter() || '').trim().toLowerCase();
    const visible = keyword
      ? this.allTags.filter((t) =>
          `${t.name()} ${t.description() || ''}`
            .toLowerCase()
            .includes(keyword)
        )
      : this.allTags.slice();

    const cats = getCategories();

    if (cats.length) {
      const { grouped, ungrouped } = pickTagsInCategories(visible, cats);

      // 默认全部折叠 (保持不变)
      if (!this.initialized) {
        cats.forEach((g) => (this.collapsed[String(g.id)] ??= true));
        if (ungrouped.length) this.collapsed.__ungrouped__ ??= true;
        this.initialized = true;
        saveCollapsed(this.collapsed);
      }

      // 展开/折叠全部 (保持不变)
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

      // === 修改点：renderHeader 调用移除 selectedSlugs 参数 ===
      // const header = this.renderHeader(selectedSlugs, expandAll, collapseAll);
      const header = this.renderHeader(expandAll, collapseAll);
      // ==================================================
      const sections: Mithril.Children[] = [];

      // 已分组 (修改 onclick)
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
              (e.key === 'Enter' || e.key === ' ') &&
              (e.preventDefault(), this.toggle(key))
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
                  // === 修改点：调用新方法 ===
                  // onclick: () => this.toggleSelect(t.slug()!),
                  onclick: () => this.updateSelection(t.slug()!),
                  // ========================
                })
              )}
            </li>
          );
        }
      });

      // 未分组 (修改 onclick)
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
              (e.key === 'Enter' || e.key === ' ') &&
              (e.preventDefault(), this.toggle(key))
            }
          >
            <i className="fas fa-chevron-down lbtc-tf-GroupHeader-caret" />
            {app.translator.trans(
              'lady-byron-tag-filter.forum.grouped.ungrouped'
            )}
          </li>
        );

        if (!isCollapsed) {
          sections.push(
            <li className="lbtc-tf-GroupBody">
              {sorted.map((t) =>
                TagChip(t, {
                  selected: selectedSet.has(t.slug()!),
                  // === 修改点：调用新方法 ===
                  // onclick: () => this.toggleSelect(t.slug()!),
                  onclick: () => this.updateSelection(t.slug()!),
                  // ========================
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
    // === 修改点：renderHeader 调用移除 selectedSlugs 参数 ===
    // const header = this.renderHeader(selectedSlugs);
    const header = this.renderHeader();
    // ==================================================
    const flat = sortTags(visible.slice());
    return [
      header,
      <div className="Modal-footer">
        <div className="lbtc-tf-GroupBody">
          {flat.map((t) =>
            TagChip(t, {
              selected: selectedSet.has(t.slug()!),
              // === 修改点：调用新方法 ===
              // onclick: () => this.toggleSelect(t.slug()!),
              onclick: () => this.updateSelection(t.slug()!),
              // ========================
            })
          )}
        </div>
      </div>,
    ];
  }

  // === 修改点：完整替换 renderHeader 方法 ===
  private renderHeader(
    expandAll?: () => void,
    collapseAll?: () => void
  ) {
    // "清除" 按钮的新逻辑：清空内部 state
    const clearAll = () => {
      this.selectedSlugs.clear();
      m.redraw();
    };

    // 从内部 state (this.selectedSlugs) 获取已选标签
    const bySlug = new Map(this.allTags.map((t) => [t.slug()!, t]));
    const selectedTags = Array.from(this.selectedSlugs)
      .map((s) => bySlug.get(s))
      .filter(Boolean) as Tag[];

    return (
      <div className="Modal-body">
        <div className="Form">
          {/* ===== 解决问题1：模拟插件A的搜索框 ===== */}
          <div className="Form-group">
            <div className={'TagsInput FormControl'}>
              <span className="TagsInput-selected">
                {selectedTags.map((tag) => (
                  <span
                    key={`sel-${tag.id()}`}
                    className="TagsInput-tag"
                    onclick={() => this.updateSelection(tag.slug()!)} // 点击移除
                  >
                    {tagLabel(tag)}
                  </span>
                ))}
              </span>
              <input
                className="FormControl"
                placeholder={app.translator.trans(
                  'lady-byron-tag-filter.forum.toolbar.placeholder'
                )}
                bidi={this.filter}
              />
            </div>
          </div>
          {/* ======================================= */}

          <div className="Form-group">
            {/* ===== 新增：提交按钮 ===== */}
            <Button
              type="submit" // 设为 submit，以触发 onsubmit
              className="Button Button--primary"
              icon="fas fa-check"
            >
              {app.translator.trans('flarum-tags.lib.tag_selection_modal.submit_button')}
            </Button>

            {/* ===== 修改：清除按钮 ===== */}
            <Button
              type="button"
              className="Button"
              style={{ marginLeft: '8px' }}
              icon="fas fa-eraser"
              onclick={clearAll} // 使用新逻辑
              disabled={!this.selectedSlugs.size} // 检查新 state
            >
              {app.translator.trans(
                'lady-byron-tag-filter.forum.toolbar.clear'
              )}
            </Button>

            {/* "展开/折叠" 按钮保持不变 */}
            {expandAll && collapseAll ? (
              <>
                <Button
                  type="button"
                  className="Button"
                  style={{ marginLeft: '8px' }}
                  onclick={expandAll}
                >
                  {app.translator.trans(
                    'lady-byron-tag-filter.forum.toolbar.expand_all'
                  )}
                </Button>
                <Button
                  type="button"
                  className="Button"
                  style={{ marginLeft: '8px' }}
                  onclick={collapseAll}
                >
                  {app.translator.trans(
                    'lady-byron-tag-filter.forum.toolbar.collapse_all'
                  )}
                </Button>
              </>
            ) : null}
          </div>

          {/* ===== 移除：旧的已选标签反馈区 ===== */}
          
        </div>
      </div>
    );
  }
  // ==================================================

  private toggle(key: string) {
    this.collapsed[key] = !this.collapsed[key];
    saveCollapsed(this.collapsed);
    m.redraw();
  }

  // === 新增方法：更新内部 state（解决问题2） ===
  private updateSelection(slug: string) {
    if (this.selectedSlugs.has(slug)) {
      this.selectedSlugs.delete(slug);
    } else {
      this.selectedSlugs.add(slug);
    }
    // 只重绘弹窗，不导航
    m.redraw();
  }
  // ==========================================

  // === 删除：旧的 toggleSelect 和 navigateWithQ ===
  // private toggleSelect(slug: string) { ... }
  // private navigateWithQ(q: string) { ... }
  // ============================================
}
