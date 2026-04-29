// SideQuest avatar button — the colored circle with initials that opens
// the identity dropdown. Identical visual treatment in every SQ surface
// (hub + every game).
// Style spec: ../../../docs/sq-style-spec.md §5

function getInitials(name) {
  return (name || '?').slice(0, 2).toUpperCase();
}

export default function SQAvatarButton({
  profile,
  onClick,
  ariaExpanded,
  ariaLabel = 'Profile and stats',
  className = '',
}) {
  const hue = profile?.avatar_hue ?? 270;
  const name = profile?.username ?? '…';
  const initials = getInitials(name);

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      aria-haspopup="true"
      aria-expanded={ariaExpanded}
      className={`w-9 h-9 rounded-full flex items-center justify-center font-bold text-white text-xs border-2 border-black/5 hover:brightness-110 transition-all ${className}`.trim()}
      style={{ background: `hsl(${hue}, 70%, 55%)` }}
    >
      {initials}
    </button>
  );
}
