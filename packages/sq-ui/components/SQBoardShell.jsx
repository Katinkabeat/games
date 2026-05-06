import { useState, useCallback, useRef, useEffect } from 'react';

// Board page shell — wraps the standard SQ in-game chrome.
// Top banner header, optional inline sub-header (back link + status +
// game-specific badges), flexible play area, fixed-position action bar.
//
// Two width modes:
//   width="wide"   (default) — Wordy's pattern. max-w-6xl, lg:flex-row
//                  with optional score sidebar + invisible spacer for
//                  visual centering. Use for games with a wide play
//                  surface (Scrabble board, etc.).
//   width="narrow" — Rungles / Snibble pattern. max-w-[480px], single
//                  column, no sidebar. Use for column-stacked games.
//
// subHeader placement is responsive (in wide mode only):
//   - Mobile (flex-col): rendered above the score panel + board.
//   - Desktop (flex-row): rendered inside the play column, above the
//     board, so it tracks the board's left/right edges.
// In narrow mode, subHeader always sits between top banner and content.
//
// Action bar — Firefox bug workaround (2026-05-06):
//   Firefox has a known bug (Mozilla 1488080, 946235, 1585254) where
//   `position: sticky bottom: 0` inside flex OR grid containers fails
//   to reserve space — the wrapper grows past the action bar's row,
//   the centred board overflows behind it, and the bottom row appears
//   mashed against the action bar. Chrome handles all of this fine.
//
//   Workaround: action bar is `position: fixed bottom: 0` (anchored to
//   viewport, never participates in shell layout). The shell measures
//   the action bar's offsetHeight via ResizeObserver and sets a CSS
//   custom property + matching paddingBottom so the play area never
//   overlaps it.
//
// Style spec: ../../../docs/sq-style-spec.md §3

export default function SQBoardShell({
  header,
  subHeader = null,
  scorePanel = null,
  actionBar = null,
  width = 'wide',
  children,
  className = '',
}) {
  const isNarrow = width === 'narrow';

  // Measure the action bar so the shell can reserve matching
  // padding-bottom. Default 0 when no action bar.
  const [actionBarH, setActionBarH] = useState(actionBar ? 160 : 0);
  const observerRef = useRef(null);
  const actionBarRefCallback = useCallback((el) => {
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }
    if (!el) {
      setActionBarH(0);
      return;
    }
    const update = () => setActionBarH(el.offsetHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    observerRef.current = ro;
  }, []);
  useEffect(() => () => {
    if (observerRef.current) observerRef.current.disconnect();
  }, []);

  const fixedActionBar = actionBar ? (
    <div
      ref={actionBarRefCallback}
      className="fixed bottom-0 left-0 right-0 z-20 bg-white dark:bg-[#1a1130] border-t border-purple-100 dark:border-[#2d1b55]"
    >
      {actionBar}
    </div>
  ) : null;

  if (isNarrow) {
    // Narrow column layout — no sidebar, no responsive sub-header
    // duplication. Sub-header sits flush with the max-w-[480px] container
    // so its own px-4 aligns with the avatar/cog above (matches Wordy's
    // wide-mode alignment). Children get their own px-4 inset.
    return (
      <div
        className={`min-h-screen min-h-dvh flex flex-col bg-gradient-to-br from-wordy-50 to-pink-50 dark:bg-[#0f0a1e] dark:bg-none ${className}`.trim()}
        style={{ paddingBottom: actionBarH }}
      >
        {header}
        <div className="flex-1 min-h-0 flex flex-col max-w-[480px] mx-auto w-full">
          {subHeader}
          <div className="flex-1 min-h-0 flex flex-col px-4 pb-3">
            {children}
          </div>
        </div>
        {fixedActionBar}
      </div>
    );
  }

  // Wide layout — Wordy's pattern. max-w-6xl with optional score sidebar.
  return (
    <div
      className={`min-h-screen min-h-dvh flex flex-col bg-gradient-to-br from-wordy-50 to-pink-50 dark:bg-[#0f0a1e] dark:bg-none ${className}`.trim()}
      style={{ paddingBottom: actionBarH }}
    >
      {header}

      {/* Mobile sub-header: above the score strip + board. */}
      {subHeader ? (
        <div className="lg:hidden max-w-6xl mx-auto w-full">{subHeader}</div>
      ) : null}

      <div className="flex-1 min-h-0 flex flex-col lg:flex-row gap-2 lg:gap-3 max-w-6xl mx-auto w-full px-1 py-2 lg:p-3">
        {scorePanel ? (
          <aside className="lg:w-56 shrink-0">{scorePanel}</aside>
        ) : null}
        <div className="flex-1 min-w-0 min-h-0 flex flex-col">
          {/* Desktop sub-header: inside the play column. */}
          {subHeader ? (
            <div className="hidden lg:block">{subHeader}</div>
          ) : null}
          <div className="flex-1 min-h-0 flex items-center justify-center">
            {children}
          </div>
        </div>
        {scorePanel ? (
          <div className="lg:w-56 shrink-0 hidden lg:block" aria-hidden="true" />
        ) : null}
      </div>

      {fixedActionBar}
    </div>
  );
}
