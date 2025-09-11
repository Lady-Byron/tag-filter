import app from 'flarum/forum/app';
import Modal from 'flarum/common/components/Modal';
import Button from 'flarum/common/components/Button';
import LoadingIndicator from 'flarum/common/components/LoadingIndicator';
import Stream from 'flarum/common/utils/Stream';
import classList from 'flarum/common/utils/classList';
import highlight from 'flarum/common/helpers/highlight';

import type Tag from 'flarum/tags/common/models/Tag';
import tagIcon from 'flarum/tags/common/helpers/tagIcon';
import sortTags from 'flarum/tags/common/utils/sortTags';

import TagChip from './TagChip';
import { getCategories, pickTagsInCategories, loadCollapsed, saveCollapsed } from '../util/categories';
import { getCurrentQ, parseQ, stringifyQ, toggleTagSlug, clearTagsInQ } from '../util/query';

type Vnode = Mithril.Vnode<Record<string, never>, TagFilterModal>;

export default class TagFilterModal extends Modal {
  private loading = true;
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

  async oninit(vnode: Vnode) {
    super.oninit(vnode);

    // 加载标签
    if (!app.store.all('tags').length) {
      await app.store.find('tags');
    }
    this.allTags = app.store.all<Tag>('tags');

    // 折叠状态
    this.collapsed = loadCollapsed();
    this.loading = false;
  }

  view(vnode: Vnode) {
    if (this.loading) return <LoadingIndicator />;

    const { tagSlugs: selectedSlugs } = parseQ(getCurrentQ());
    const selectedSet = new Set(selectedSlugs);

    // 过滤：名称/描述包含关键字
    const keyword = (this.filter() || '').trim().toLowerCase();
    const visible = keyword
      ? this.allTags.filter((t) => {
          const text = `${t.name()} ${t.description() || ''}`.toLowerCase();
          return text.includes(keyword);
        })
      : this.allTags.slice();

    // 若存在分类 → 按分类分组；否则扁平
    const cats = getCategories();
    const sections: Mithril.Children[] = [];

    if (cats.length) {
      const { grouped, ungrouped } = pickTagsInCategories(visible, cats);

      // 首次默认全部折叠
      if (!this.initialized) {
        cats.forEach((g) => (this.collapsed[String(g.id)] ??= true));
        if (ungrouped.length) this.collapsed.__ungrouped__ ??= true;
        this.initialized = true;
        saveCollapsed(this.collapsed);
      }

      // 批量展开/折叠
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

      // Header: 搜索/清空/展开折叠
      const header = this.renderHeader(selectedSlugs, expandAll, collapseAll);
      sections.push(header);

      // 已分组
      grouped.forEach(({ group, tags }) => {
        const key = String(group.id);
        const isCollapsed = !!this.collapsed[key];
        const sorted = sortTags(tags.slice());

        sections.push(
          <li
            class={classList('lbtc-tf-GroupHeader', { collapsed: isCollapsed })}
            role="button"
            aria-expanded={!isCollapsed}
            tabindex="0"
            onclick={() => this.toggle(key)}
            onkeydown={(e: KeyboardEvent) => (e.key === 'Enter' || e.key === ' ') && this.toggle(key)}
          >
            <i class="fas fa-chevron-down lbtc-tf-GroupHeader-caret" />
            {group.name}
          </li>
        );

        if (!isCollapsed) {
          sections.push(
            <li class="lbtc-tf-GroupBody">
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
            class={classList('lbtc-tf-GroupHeader', { collapsed: isCollapsed })}
            role="button"
            aria-expanded={!isCollapsed}
            tabindex="0"
            onclick={() => this.toggle(key)}
            onkeydown={(e: KeyboardEvent) => (e.key === 'Enter' || e.key === ' ') && this.toggle(key)}
          >
            <i class="fas fa-chevron-down lbtc-tf-GroupHeader-caret" />
            {app.translator.trans('lady-byron-tag-filter.forum.grouped.ungrouped')}
          </li>
        );

        if (!isCollapsed) {
          sections.push(
            <li class="lbtc-tf-GroupBody">
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

      return <ul class="lbtc-tf-GroupList">{sections}</ul>;
    }

    // —— 无分类回退：复刻原扁平区域（顶部 header + 扁平芯片）
    const header = this.renderHeader(selectedSlugs);
    const flat = sortTags(visible.slice());

    return (
      <div>
        {header}
        <div class="lbtc-tf-GroupBody">
          {flat.map((t) =>
            TagChip(t, {
              selected: selectedSet.has(t.slug()!),
              onclick: () => this.toggleSelect(t.slug()!),
            })
          )}
        </div>
      </div>
    );
  }

  private renderHeader(selectedSlugs: string[], expandAll?: () => void, collapseAll?: () => void) {
    const clearAll = () => {
      const q = getCurrentQ();
      const cleared = stringifyQ(clearTagsInQ(q));
      this.navigateWithQ(cleared);
    };

    return (
      <div class="Modal-body">
        <div class="Form">
          <div class="Form-group">
            <input
              class="FormControl"
              placeholder={app.translator.trans('lady-byron-tag-filter.forum.toolbar.placeholder')}
              bidi={this.filter}
            />
          </div>
          <div class="Form-group">
            <Button className="Button" icon="fas fa-eraser" onclick={clearAll} disabled={!selectedSlugs.length}>
              {app.translator.trans('lady-byron-tag-filter.forum.toolbar.clear')}
            </Button>
            {expandAll && collapseAll ? (
              <>
                <Button className="Button" style="margin-left:8px" onclick={expandAll}>
                  {app.translator.trans('lady-byron-tag-filter.forum.toolbar.expand_all')}
                </Button>
                <Button className="Button" style="margin-left:8px" onclick={collapseAll}>
                  {app.translator.trans('lady-byron-tag-filter.forum.toolbar.collapse_all')}
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

  private toggleSelect(slug: string) {
    const q = getCurrentQ();
    const { rest, tagSlugs } = parseQ(q);
    const next = toggleTagSlug(rest, tagSlugs, slug);
    this.navigateWithQ(stringifyQ(next));
  }

  private navigateWithQ(q: string) {
    // 跳到首页并携带 q；保留其他常用参数可按需扩展
    m.route.set(app.route('index', q ? { q } : {}));
    this.hide();
  }
}
