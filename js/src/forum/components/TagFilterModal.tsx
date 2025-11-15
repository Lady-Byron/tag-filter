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

  // (卡死问题修复：移除 this.hide())
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
  }

  // (保留 "X" 按钮的双重保险)
  oncreate(vnode: Mithril.VnodeDOM) {
    super.oncreate(vnode);
    
    const closeBtn =
      this.element?.querySelector<HTMLButtonElement>('.Modal-close');

    if (closeBtn) {
      closeBtn.setAttribute('type', 'button');
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

      // (默认折叠状态，保持不变)
      if (!this.initialized) {
        cats.forEach((g) => (this.collapsed[String(g.id)] ??= true));
        if (ungrouped.length) this.collapsed.__ungrouped__ ??= true;
        this.initialized = true;
      }

      // === 新增：自动展开搜索命中的分组 ===
      if (keyword.length > 0) {
        // 1. 找出所有有结果的分组 ID
        // (grouped 已经是被 keyword 过滤后的结果)
        const groupsWithResults = new Set(grouped.map(g => String(g.group.id)));
        
        // 2. 遍历所有分类，如果它之前是折叠的 (true)，但现在有了搜索结果，就展开它 (false)
        cats.forEach((g) => {
          const key = String(g.id);
          if (this.collapsed[key] === true && groupsWithResults.has(key)) {
            this.collapsed[key] = false;
          }
        });

        // 3. 同样地，检查“未分组”
        if (this.collapsed['__ungrouped__'] === true && ungrouped.length > 0) {
          this.collapsed['__ungrouped__'] = false;
        }
      }
      // ===================================

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
        // (由于上面的自动展开逻辑，此处的 isCollapsed 会在搜索时正确地变为 false)
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

  // (V5.0 的 Header 修复版，保持不变)
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

    const placeholder = app.translator.trans(
      'lady-byron-tag-filter.forum.toolbar.placeholder'
    );
    
    const inputAttrs: any = {
      className: 'FormControl',
      placeholder: placeholder,
      bidi: this.filter,
    };

    if (selectedTags.length > 0) {
      const inputWidth = Math.max(
        10,
        lengthWithCJK(placeholder),
        lengthWithCJK(this.filter())
      );
      inputAttrs.style = { width: inputWidth + 'ch' };
    }

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
              <input {...inputAttrs} />
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

  private updateSelection(slug: string) {
    if (this.selectedSlugs.has(slug)) {
      this.selectedSlugs.delete(slug);
    } else {
      this.selectedSlugs.add(slug);
    }
    m.redraw();
  }
}

/** 与原生一致的宽度计算：CJK 算 2 个字符宽 */
function lengthWithCJK(text: string) {
  let len = 0;
  for (const ch of text || '') {
    len += /[\u4E00-\u9FFF\u3400-\u4DBF\uF900-\uFAFF]/.test(ch) ? 2 : 1;
  }
  return len + 1;
}
