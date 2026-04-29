// Single row inside an SQ avatar dropdown. Standard hover, padding, and
// text colour. Use for "📊 Stats", colour picker rows on the hub, etc.
// Style spec: ../../../docs/sq-style-spec.md §5

export default function SQAvatarMenuItem({
  onClick,
  danger = false,
  className = '',
  children,
  ...rest
}) {
  const colorCls = danger
    ? 'text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-900/30'
    : 'text-wordy-700 dark:text-wordy-300 hover:bg-wordy-50 dark:hover:bg-[#2d1b55]';
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`w-full text-left px-3 py-2.5 text-sm transition-colors ${colorCls} ${className}`.trim()}
      {...rest}
    >
      {children}
    </button>
  );
}
