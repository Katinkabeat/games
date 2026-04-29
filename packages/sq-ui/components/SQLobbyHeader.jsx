// Lobby header — used on every game's landing page.
// Sticky, max-w-480, identity-forward (avatar + game title left, 🏠 + ⚙️ right).
// Style spec: ../../../docs/sq-style-spec.md §4

export default function SQLobbyHeader({
  title,
  avatarSlot = null,
  rightSlot = null,
  className = '',
}) {
  return (
    <header
      className={`sticky top-0 bg-[#fff] dark:bg-[#130c25] border-b border-[#e9d5ff] dark:border-[#2d1b55] shadow-sm z-10 ${className}`.trim()}
    >
      <div className="max-w-[480px] mx-auto px-4 py-3 flex items-center gap-3">
        {avatarSlot}
        <h1 className="font-display text-2xl text-wordy-700 flex-1 truncate">
          {title}
        </h1>
        {rightSlot}
      </div>
    </header>
  );
}
