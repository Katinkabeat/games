// SideQuest settings menu — composable rows for the cog dropdown.
// Hub and game cog menus differ in content, so this exports row primitives
// rather than a fixed structure. See sq-conventions.md §"Cog dropdown" for
// what each surface should include.
// Style spec: ../../../docs/sq-style-spec.md §5

export function SQSettingsRow({
  label,
  control = null,
  onClick,
  danger = false,
  className = '',
  ...rest
}) {
  const isButton = !!onClick;
  const Tag = isButton ? 'button' : 'div';
  const colorCls = danger
    ? 'text-rose-600 hover:text-rose-700'
    : 'text-wordy-700';
  return (
    <Tag
      className={`settings-row text-sm font-bold w-full text-left ${colorCls} ${className}`.trim()}
      onClick={onClick}
      type={isButton ? 'button' : undefined}
      role={isButton ? 'menuitem' : undefined}
      {...rest}
    >
      <span>{label}</span>
      {control}
    </Tag>
  );
}

export function SQSettingsSection({ children, className = '' }) {
  return (
    <div className={`settings-section ${className}`.trim()}>{children}</div>
  );
}
