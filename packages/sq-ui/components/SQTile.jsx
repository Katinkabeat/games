// SideQuest tile primitive — letter tiles, status tiles, anything tile-shaped.
// States: default / selected / placed / disabled.
// Style spec: ../../../docs/sq-style-spec.md §5

const STATE_CLASS = {
  default:  '',
  selected: 'tile-selected',
  placed:   'tile-placed',
  disabled: 'tile-disabled',
};

export default function SQTile({
  letter,
  value = null,
  state = 'default',
  size = 44,
  className = '',
  onClick,
  ...rest
}) {
  const stateCls = STATE_CLASS[state] ?? '';
  const fontSize = Math.max(10, Math.round(size * 0.48));
  return (
    <div
      className={`tile ${stateCls} ${className}`.trim()}
      style={{ width: size, height: size, fontSize }}
      onClick={state === 'disabled' ? undefined : onClick}
      role={onClick ? 'button' : undefined}
      {...rest}
    >
      {letter}
      {value != null && <span className="tile-value">{value}</span>}
    </div>
  );
}
