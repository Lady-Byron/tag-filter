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
  // 用自有字段名，避免与基类 Modal.loading 冲突
  private tfLoading = true;

  private allTags: Tag[] = [];
  private filter = Stream<string>('');
  private collapsed: Record<string, boolean> = {};
  private initialized = false;

  // 防止 guard 重入
  private guardPending = false;

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

  // 表单提交一律视为“关闭”以规避 submit 干扰
  onsubmit(e: SubmitEvent) {
    e.preventDefault();
    this.hide();
  }

  oncreate(vnode: Mithril.VnodeDOM) {
    super.oncreate(vnode);
    this.fixCloseButton();
  }

  onupdate(vnode: Mithril.VnodeDOM) {
    // @ts-ignore
    super.onupdate?.(vnode);
    this.fixCloseButton();
  }

  /**
   * 让右上角 X 必定可点：
   * - 统一设为 type="button"
   * - 移除 disabled/aria-disabled
   * - 绑定捕获级点击直接关闭
   * - 每次重绘后都执行，防止被基类再次置回禁用
   */
  private fixCloseButton() {
    const root = this.element as HTMLElement | null;
    if (!root) return;

    const btn = root.querySelector<HTMLButtonElement>('.Modal-close');
    if (!btn) return;

    // 永远是普通按钮，而不是 submit
    btn.type = 'button';

    // 移除禁用态（Flarum 基类可能在 loading 时加上）
    btn.removeAttribute('disabled');
    btn.removeAttribute('aria-disabled');
    (btn as any).disabled = false;

    // 只绑定一次捕获级点击（优先于其它监听）
    if (!(btn as any)._lbtcBound) {
      (btn as any)._lbtcBound = true;
      btn.addEventListener(
        'click',
        (e) => {
          e.preventDefault();
          e.stopPropagation();
          // 直接调用自身 hide（等价于 app.modal.close()）
          this.hide();
        },
        { capture: true }
      );
    }
  }

  /**
   * 渲染前兜底：若发现分类中的某些 tagId 仍未载入，
   * 触发一次后台加载并显示 Loading；加载完自动重绘。
   * 同步返回：true=可渲染，false=需等待。
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
    // 若仍缺失，先显示 Loading，等 guard 拉完再渲染
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

      // 默认全部折叠（含“未分组”），只做一次；状态持久化
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
