// Lobby page shell — wraps the standard SQ lobby chrome.
// Header sticky, gradient background that flattens to dark in dark mode,
// max-w-480 column with `space-y-6` between cards.
// Style spec: ../../../docs/sq-style-spec.md §3

export default function SQLobbyShell({ header, children, className = '' }) {
  return (
    <div
      className={`min-h-screen bg-gradient-to-br from-wordy-50 via-pink-50 to-wordy-100 dark:bg-[#0f0a1e] dark:bg-none ${className}`.trim()}
    >
      {header}
      <main className="max-w-[480px] mx-auto px-4 py-6 space-y-6">
        {children}
      </main>
    </div>
  );
}
