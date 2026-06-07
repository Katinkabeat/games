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
  disabled = false,
  className = '',
  ...rest
}) {
  // A disabled row is shown but greyed out and non-interactive — used e.g. for
  // "Claim win" before the opponent's 7-day inactivity threshold is reached.
  const isButton = !!onClick && !disabled;
  const Tag = isButton ? 'button' : 'div';
  const colorCls = disabled
    ? 'text-gray-400 dark:text-gray-500 cursor-not-allowed'
    : danger
      ? 'text-rose-600 hover:text-rose-700'
      : 'text-wordy-700';
  return (
    <Tag
      className={`settings-row text-sm font-bold w-full text-left ${colorCls} ${className}`.trim()}
      onClick={disabled ? undefined : onClick}
      type={isButton ? 'button' : undefined}
      role={isButton ? 'menuitem' : undefined}
      aria-disabled={disabled || undefined}
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
