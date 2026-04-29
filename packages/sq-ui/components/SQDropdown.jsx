// SideQuest dropdown — floating panel anchored to a trigger.
// Closes on outside click and Escape. The wrapping element handles
// `position: relative` so the dropdown can absolute-position itself.
// Style spec: ../../../docs/sq-style-spec.md §5

import { useEffect, useRef } from 'react';

export default function SQDropdown({
  open,
  onClose,
  align = 'right',
  children,
  className = '',
}) {
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    function onKey(e) {
      if (e.key === 'Escape') onClose?.();
    }
    function onDown(e) {
      if (ref.current && !ref.current.contains(e.target)) onClose?.();
    }
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  const alignCls = align === 'left' ? 'left-0' : 'right-0';

  return (
    <div
      ref={ref}
      className={`settings-dropdown card dropdown-surface ${alignCls} ${className}`.trim()}
      role="menu"
    >
      {children}
    </div>
  );
}
