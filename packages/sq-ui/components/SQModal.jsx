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
        className={`card dropdown-surface w-full max-w-sm shadow-xl max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain ${className}`.trim()}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="sticky top-0 -mt-1 pt-1 pb-2 bg-white dark:bg-[#1a1130] flex items-start justify-between gap-3 mb-3">
          {title ? (
            <h3 className="font-display text-lg leading-tight">{title}</h3>
          ) : <span />}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 -mt-1 -mr-1 w-8 h-8 inline-flex items-center justify-center rounded-full text-current/70 hover:bg-black/5 text-xl leading-none"
          >
            ×
          </button>
        </div>
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
