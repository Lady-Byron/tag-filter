// js/src/forum/components/TagFilterModal.tsx

import app from 'flarum/forum/app';
import Modal from 'flarum/common/components/Modal';
import Button from 'flarum/common/components/Button';
import LoadingIndicator from 'flarum/common/components/LoadingIndicator';
import Stream from 'flarum/common/utils/Stream';
import classList from 'flarum/common/utils/classList';
import sortTags from 'flarum/tags/common/utils/sortTags';
import type Tag from 'flarum/tags/common/models/Tag';
import tagLabel from 'flarum/tags/common/helpers/tagLabel';

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
  private guardPending = false;
  private selectedSlugs!: Set<string>;

  className() {
    return 'lbtc-tf-Modal Modal--large';
  }

  title() {
    return app.translator.trans('lady-byron-tag-filter.forum.toolbar.button');
  }

  async oninit(vnode: Vnode) {
    super.oninit(vnode);
    this.collapsed = loadCollapsed();

    const { tagSlugs } = parseQ(getCurrentQ());
    this.selectedSlugs = new Set(tagSlugs);

    await ensureCategoryTagsLoaded();
    this.allTags = app.store.all<Tag>('tags');
    this.loading = false;
  }

  onsubmit(e: SubmitEvent) {
    e.preventDefault();

    const q = getCurrentQ();
    const { rest } = parseQ(q);

    const next = { rest, tagSlugs: Array.from(this.selectedSlugs) };
    const newQ = stringifyQ(next);

    const oldQ = stringifyQ(parseQ(q));
    if (newQ !== oldQ) {
      m.route.set(app.route('index', newQ ? { q: newQ } : {}));
    }

    this.hide();
  }

  // === 修复版：无条件设置 type=button 修复 X 按钮卡死 ===
  oncreate(vnode: Mithril.VnodeDOM) {
    super.oncreate(vnode);
    
    const closeBtn =
      this.element?.querySelector<HTMLButtonElement>('.Modal-close');

    if (closeBtn) {
      closeBtn.setAttribute('type', 'button');
    }
  }
  // ===============================================

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

    if (!this.guardEnsureLoaded()) {
      return (
        <div className="Modal-body">
          <LoadingIndicator />
        </div>
      );
    }

    const selectedSet = this.selectedSlugs;

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

      const header = this.renderHeader(expandAll, collapseAll);
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
                  onclick: () => this.updateSelection(t.slug()!),
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
                  onclick: () => this.updateSelection(t.slug()!),
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
    const header = this.renderHeader();
    const flat = sortTags(visible.slice());
    return [
      header,
      <div className="Modal-footer">
        <div className="lbtc-tf-GroupBody">
          {flat.map((t) =>
            TagChip(t, {
              selected: selectedSet.has(t.slug()!),
              onclick: () => this.updateSelection(t.slug()!),
            })
          )}
        </div>
      </div>,
    ];
  }

  // === 修复版：添加 inputWidth 修复挤压问题 + 添加 icons 修复图标问题 ===
  private renderHeader(
    expandAll?: () => void,
    collapseAll?: () => void
  ) {
    const clearAll = () => {
      this.selectedSlugs.clear();
      m.redraw();
    };

    const bySlug = new Map(this.allTags.map((t) => [t.slug()!, t]));
    const selectedTags = Array.from(this.selectedSlugs)
      .map((s) => bySlug.get(s))
      .filter(Boolean) as Tag[];

    // --- 挤压问题修复：开始 ---
    const placeholder = app.translator.trans(
      'lady-byron-tag-filter.forum.toolbar.placeholder'
    );
    // 计算输入框应有的最小宽度
    const inputWidth = Math.max(
      lengthWithCJK(placeholder),
      lengthWithCJK(this.filter())
    );
    // --- 挤压问题修复：结束 ---

    return (
      <div className="Modal-body">
        <div className="Form">
          <div className="Form-group">
            <div className={'TagsInput FormControl'}>
              <span className="TagsInput-selected">
                {selectedTags.map((tag) => (
                  <span
                    key={`sel-${tag.id()}`}
                    className="TagsInput-tag"
                    onclick={() => this.updateSelection(tag.slug()!)}
                  >
                    {tagLabel(tag)}
                  </span>
                ))}
              </span>
              <input
                className="FormControl"
                placeholder={placeholder}
                bidi={this.filter}
                // --- 挤压问题修复：应用动态宽度 ---
                style={{ width: inputWidth + 'ch' }}
              />
            </div>
          </div>

          <div className="Form-group">
            <Button
              type="submit"
              className="Button Button--primary"
              icon="fas fa-check"
            >
              {app.translator.trans('flarum-tags.lib.tag_selection_modal.submit_button')}
            </Button>

            <Button
              type="button"
              className="Button"
              style={{ marginLeft: '8px' }}
              icon="fas fa-eraser"
              onclick={clearAll}
              disabled={!this.selectedSlugs.size}
            >
              {app.translator.trans(
                'lady-byron-tag-filter.forum.toolbar.clear'
              )}
            </Button>

            {/* --- 图标问题修复：添加 icon 属性 --- */}
            {expandAll && collapseAll ? (
              <>
                <Button
                  type="button"
                  className="Button"
                  style={{ marginLeft: '8px' }}
                  onclick={expandAll}
                  icon="fas fa-angle-double-down"
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
                  icon="fas fa-angle-double-up"
                >
                  {app.translator.trans(
                    'lady-byron-tag-filter.forum.toolbar.collapse_all'
                  )}
                </Button>
              </>
            ) : null}
            {/* --- 图标问题修复：结束 --- */}
          </div>
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

  private updateSelection(slug: string) {
    if (this.selectedSlugs.has(slug)) {
      this.selectedSlugs.delete(slug);
    } else {
      this.selectedSlugs.add(slug);
    }
    m.redraw();
  }
}

// === 挤压问题修复：从插件A移植的辅助函数 ===
/** 与原生一致的宽度计算：CJK 算 2 个字符宽 */
function lengthWithCJK(text: string) {
  let len = 0;
  for (const ch of text || '') {
    len += /[\u4E00-\u9FFF\u3400-\u4DBF\uF900-\uFAFF]/.test(ch) ? 2 : 1;
  }
  // 为输入框光标额外增加一点宽度
  return len + 1;
}
// ========================================
