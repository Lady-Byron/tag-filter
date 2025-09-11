import tagIcon from 'flarum/tags/common/helpers/tagIcon';
import type Tag from 'flarum/tags/common/models/Tag';

/**
 * 彩色+图标的“紧密芯片”
 * - 用 CSS 变量 --tag-title-color 驱动文字着色
 * - 选中且无自定义图标时显示对勾
 * - 加 title 以便悬停查看完整名称/描述
 */
export default function TagChip(
  tag: Tag,
  opts: { selected?: boolean; onclick?: () => void } = {}
) {
  const color = tag.color() || 'var(--tag-color)';
  const selected = !!opts.selected;

  const name = tag.name() || '';
  const desc = tag.description() || '';
  const title = desc ? `${name} — ${desc}` : name;

  return (
    <button
      type="button" // 防止提交表单
      className={'lbtc-tf-Chip Button ' + (selected ? 'is-selected' : '')}
      style={{ '--tag-title-color': color } as any}
      title={title}
      onclick={opts.onclick}
      data-tag-slug={tag.slug() || ''}
      data-tag-id={tag.id() || ''}
    >
      <span className="Button-label">
        <i className="SelectTagListItem-icon">
          {tag.icon()
            ? tagIcon(tag, { className: 'SelectTagListItem-tagIcon' })
            : selected
              ? <i className="icon TagIcon fas fa-check SelectTagListItem-checkIcon" />
              : tagIcon(tag, { className: 'SelectTagListItem-tagIcon' })}
        </i>
        <span className="SelectTagListItem-name">{name}</span>
        {desc ? <span className="SelectTagListItem-description">{desc}</span> : null}
      </span>
    </button>
  );
}

