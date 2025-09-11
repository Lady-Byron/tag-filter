import tagIcon from 'flarum/tags/common/helpers/tagIcon';
import type Tag from 'flarum/tags/common/models/Tag';

/**
 * 彩色+图标的“紧密芯片”
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
      type="button"                                       // ★ 防止提交表单
      className={'lbtc-tf-Chip Button ' + (selected ? 'is-selected' : '')}
      style={{ '--tag-title-color': color } as any}
      onclick={opts.onclick}
    >
      <span className="Button-label">
        <i className="SelectTagListItem-icon">
          {tag.icon()
            ? tagIcon(tag, { className: 'SelectTagListItem-tagIcon' })
            : selected
              ? <i className="icon TagIcon fas fa-check SelectTagListItem-checkIcon" />
              : tagIcon(tag, { className: 'SelectTagListItem-tagIcon' })}
        </i>
        <span className="SelectTagListItem-name">{tag.name()}</span>
        {tag.description() ? <span className="SelectTagListItem-description">{tag.description()}</span> : null}
      </span>
    </button>
  );
}

