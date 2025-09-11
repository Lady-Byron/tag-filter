import tagIcon from 'flarum/tags/common/helpers/tagIcon';
import type Tag from 'flarum/tags/common/models/Tag';

/**
 * 彩色+图标的“紧密芯片”，复刻 tags-filter 的展示思路：
 * - 用 CSS 变量 --tag-title-color 驱动文字着色（background-clip:text）
 * - 选中且无自定义图标时显示对勾
 */
export default function TagChip(
  tag: Tag,
  opts: { selected?: boolean; onclick?: () => void } = {}
) {
  const color = tag.color() || 'var(--tag-color)';
  const selected = !!opts.selected;

  return (
    <button
      className={'lbtc-tf-Chip Button ' + (selected ? 'is-selected' : '')}
      style={{ '--tag-title-color': color } as any}
      onclick={opts.onclick}
    >
      <span class="Button-label">
        <i class="SelectTagListItem-icon">
          {tag.icon()
            ? tagIcon(tag, { className: 'SelectTagListItem-tagIcon' })
            : selected
              ? <i class="icon TagIcon fas fa-check SelectTagListItem-checkIcon" />
              : tagIcon(tag, { className: 'SelectTagListItem-tagIcon' })}
        </i>
        <span class="SelectTagListItem-name">{tag.name()}</span>
        {tag.description() ? <span class="SelectTagListItem-description">{tag.description()}</span> : null}
      </span>
    </button>
  );
}
