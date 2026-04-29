// SideQuest avatar dropdown — the identity-card-plus-menu-items panel
// that opens beneath the avatar button. Owns the standard chrome (surface,
// border, identity card with avatar + name + "Your profile" subtitle).
// Children are the per-game menu items, each typically rendered with
// <SQAvatarMenuItem>. Every SQ surface (hub + every game) uses this.
//
// Standard items (per sq-conventions.md "Avatar dropdown content"):
//   - In each game: identity card + 📊 Stats
//   - In the hub: identity card + colour picker + 📊 Stats
//
// Style spec: ../../../docs/sq-style-spec.md §5

import { useEffect, useRef } from 'react';

function getInitials(name) {
  return (name || '?').slice(0, 2).toUpperCase();
}

export default function SQAvatarDropdown({
  open,
  onClose,
  profile,
  align = 'left',
  className = '',
  children,
}) {
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    function onDoc(e) {
      if (ref.current && !ref.current.contains(e.target)) onClose?.();
    }
    function onKey(e) {
      if (e.key === 'Escape') onClose?.();
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  const hue = profile?.avatar_hue ?? 270;
  const name = profile?.username ?? '…';
  const initials = getInitials(name);
  const alignCls = align === 'right' ? 'right-0' : 'left-0';

  return (
    <div
      ref={ref}
      role="menu"
      className={`absolute ${alignCls} top-full mt-2 w-60 bg-[#fff] dark:bg-[#241640] border border-[#e9d5ff] dark:border-[#6d28d9] rounded-xl shadow-lg z-50 py-1 ${className}`.trim()}
    >
      <div className="flex items-center gap-2.5 px-3 py-2.5 border-b border-[#e9d5ff] dark:border-[#6d28d9]">
        <div
          className="w-9 h-9 rounded-full flex items-center justify-center font-bold text-white text-xs"
          style={{ background: `hsl(${hue}, 70%, 55%)` }}
        >
          {initials}
        </div>
        <div className="min-w-0">
          <div className="font-bold text-wordy-700 dark:text-wordy-300 text-sm truncate">
            {name}
          </div>
          <div className="text-xs text-wordy-500">Your profile</div>
        </div>
      </div>
      {children}
    </div>
  );
}
