// SideQuest modal — full-screen overlay with a centered card body.
// Closes on backdrop click and Escape. Pass `open` to control visibility.
// Style spec: ../../../docs/sq-style-spec.md §5

import { useEffect } from 'react';

export default function SQModal({
  open,
  onClose,
  title = null,
  children,
  actions = null,
  closeOnBackdrop = true,
  className = '',
}) {
  useEffect(() => {
    if (!open) return undefined;
    function onKey(e) {
      if (e.key === 'Escape') onClose?.();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
      onClick={closeOnBackdrop ? onClose : undefined}
    >
      <div
        className={`card dropdown-surface w-full max-w-sm shadow-xl ${className}`.trim()}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {title && (
          <h3 className="font-display text-lg mb-3">{title}</h3>
        )}
        {children}
        {actions && (
          <div className="mt-4 flex items-center justify-end gap-2">
            {actions}
          </div>
        )}
      </div>
    </div>
  );
}
