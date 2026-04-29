import { useState } from 'react';
import {
  SQCard,
  SQButton,
  SQLobbyHeader,
  SQBoardHeader,
  SQLobbyShell,
  SQBoardShell,
  SQCompletedGamesCard,
  SQTile,
  SQModal,
  SQDropdown,
  SQSettingsRow,
  SQSettingsSection,
} from '../../packages/sq-ui/index.js';
import { useTheme } from '../contexts/ThemeContext.jsx';

// Visual smoke test for the sq-ui package. Reachable via ?styleguide=1.
// Renders every token, primitive, and (in later stages) shell so the
// design system can be reviewed in isolation, in both light and dark mode.

const SWATCHES = [
  { label: 'wordy-50',  hex: '#faf5ff' },
  { label: 'wordy-100', hex: '#f3e8ff' },
  { label: 'wordy-200', hex: '#e9d5ff' },
  { label: 'wordy-300', hex: '#d8b4fe' },
  { label: 'wordy-400', hex: '#c084fc' },
  { label: 'wordy-500', hex: '#a855f7' },
  { label: 'wordy-600', hex: '#9333ea' },
  { label: 'wordy-700', hex: '#7e22ce' },
  { label: 'wordy-800', hex: '#6b21a8' },
  { label: 'wordy-900', hex: '#581c87' },
];

const PINK_ACCENTS = [
  { label: 'pink-400 (selection ring)', hex: '#f472b6' },
  { label: 'rose-400 (exchange tint)',   hex: '#fb7185' },
  { label: 'pink-500 (centre cell)',     hex: '#ec4899' },
];

const DARK_SURFACES = [
  { label: 'page bg',       hex: '#0f0a1e' },
  { label: 'surface 1 (cards)', hex: '#1a1130' },
  { label: 'surface 2 (overlays)', hex: '#241640' },
  { label: 'border',        hex: '#2d1b55' },
  { label: 'border raised', hex: '#6d28d9' },
  { label: 'text primary',  hex: '#ede0ff' },
  { label: 'text muted',    hex: '#c4b5fd' },
];

function Swatch({ label, hex }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <div
        className="w-10 h-10 rounded-lg border border-purple-100"
        style={{ backgroundColor: hex }}
      />
      <div className="flex flex-col">
        <span className="font-bold">{label}</span>
        <span className="opacity-70 font-mono">{hex}</span>
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <SQCard>
      <h2 className="font-display text-lg mb-3">{title}</h2>
      {children}
    </SQCard>
  );
}

export default function StyleGuidePage() {
  const { isDark, toggle } = useTheme();
  const [modalOpen, setModalOpen] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);

  return (
    <div className="min-h-screen bg-gradient-to-br from-wordy-50 via-pink-50 to-wordy-100 dark:bg-[#0f0a1e] dark:bg-none">
      <header className="sticky top-0 bg-white dark:bg-[#130c25] border-b border-purple-100 shadow-sm z-10">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
          <h1 className="font-display text-2xl text-wordy-700 flex-1">
            sq-ui style guide
          </h1>
          <button
            type="button"
            onClick={toggle}
            className="text-2xl hover:scale-110 transition-transform"
            title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {isDark ? '☀️' : '🌙'}
          </button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        <SQCard>
          <p className="text-sm">
            Stage 1 of the sq-ui rollout. This page renders every token and
            primitive shipping today so you can review the foundation in
            both light and dark mode before the rest of the package is built
            out (headers, shells, tile, modal, dropdown).
          </p>
        </SQCard>

        <Section title="🎨 Purple palette (primary)">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {SWATCHES.map((s) => (
              <Swatch key={s.label} {...s} />
            ))}
          </div>
        </Section>

        <Section title="💗 Pink accents">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {PINK_ACCENTS.map((s) => (
              <Swatch key={s.label} {...s} />
            ))}
          </div>
        </Section>

        <Section title="🌙 Dark mode surfaces">
          <p className="text-xs opacity-70 mb-3">
            These are the canonical dark-mode values. Toggle the header
            button to see them applied to this page.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {DARK_SURFACES.map((s) => (
              <Swatch key={s.label} {...s} />
            ))}
          </div>
        </Section>

        <Section title="✏️ Typography">
          <div className="space-y-3">
            <div>
              <div className="text-xs opacity-70 mb-1">font-display text-2xl text-wordy-700 (lobby title)</div>
              <div className="font-display text-2xl text-wordy-700">Wordy</div>
            </div>
            <div>
              <div className="text-xs opacity-70 mb-1">font-display text-lg (section heading)</div>
              <div className="font-display text-lg">🌸 New Game</div>
            </div>
            <div>
              <div className="text-xs opacity-70 mb-1">font-display text-base (board status)</div>
              <div className="font-display text-base">✨ Your turn!</div>
            </div>
            <div>
              <div className="text-xs opacity-70 mb-1">font-body font-bold text-sm (button label)</div>
              <div className="font-body font-bold text-sm">Submit Move</div>
            </div>
            <div>
              <div className="text-xs opacity-70 mb-1">font-body text-sm (body)</div>
              <div className="font-body text-sm">
                The quick brown fox jumps over the lazy dog. 0123456789.
              </div>
            </div>
            <div>
              <div className="text-xs opacity-70 mb-1">font-body text-xs (metadata)</div>
              <div className="font-body text-xs">2 rungs · 4 minutes ago</div>
            </div>
          </div>
        </Section>

        <Section title="🔘 Buttons">
          <div className="space-y-3">
            <div>
              <div className="text-xs opacity-70 mb-2">Primary — gradient purple, raised shadow</div>
              <div className="flex flex-wrap gap-2">
                <SQButton>Create Game</SQButton>
                <SQButton disabled>Disabled</SQButton>
              </div>
            </div>
            <div>
              <div className="text-xs opacity-70 mb-2">Secondary — bordered, lower-emphasis</div>
              <div className="flex flex-wrap gap-2">
                <SQButton variant="secondary">Cancel</SQButton>
                <SQButton variant="secondary" disabled>Disabled</SQButton>
              </div>
            </div>
            <div>
              <div className="text-xs opacity-70 mb-2">Danger — rose, destructive actions</div>
              <div className="flex flex-wrap gap-2">
                <SQButton variant="danger">Forfeit</SQButton>
                <SQButton variant="danger">Log out</SQButton>
              </div>
            </div>
          </div>
        </Section>

        <Section title="🃏 Cards">
          <div className="space-y-3">
            <SQCard>
              <h3 className="font-display text-lg mb-2">🌸 New Game</h3>
              <p className="text-sm mb-3">
                Cards are the default container for every section on a lobby
                or board page. White in light mode, surface-1 in dark.
              </p>
              <SQButton>Start</SQButton>
            </SQCard>
            <SQCard>
              <h3 className="font-display text-lg mb-2">🎮 Multiplayer</h3>
              <p className="text-sm opacity-70">No active games right now.</p>
            </SQCard>
          </div>
        </Section>

        <Section title="🧱 Lobby header (live demo)">
          <p className="text-xs opacity-70 mb-3">
            Sticky, max-w-480, identity-forward. Avatar + game title left,
            🏠 + ⚙️ right.
          </p>
          <div className="border border-dashed border-purple-300 rounded-xl overflow-hidden">
            <SQLobbyHeader
              title="Wordy"
              avatarSlot={
                <div className="w-9 h-9 rounded-full bg-wordy-500 text-white flex items-center justify-center font-bold text-sm shrink-0">
                  R
                </div>
              }
              rightSlot={
                <div className="flex items-center gap-3 shrink-0 text-2xl">
                  <span title="Back to hub">🏠</span>
                  <span title="Settings" className="text-lg">⚙️</span>
                </div>
              }
            />
            <div className="p-4 text-xs opacity-70">
              ↑ This is what the lobby header looks like at the top of any
              SQ game's landing page.
            </div>
          </div>
        </Section>

        <Section title="🎯 Board header (live demo)">
          <p className="text-xs opacity-70 mb-3">
            Not sticky, max-w-6xl, compact. Back link left, status center,
            🏠 + game badge + ⚙️ right.
          </p>
          <div className="border border-dashed border-purple-300 rounded-xl overflow-hidden">
            <SQBoardHeader
              centerSlot={
                <div className="font-display text-base text-wordy-700">
                  ✨ Your turn!
                </div>
              }
              rightSlot={
                <>
                  <span className="text-lg" title="Back to hub">🏠</span>
                  <span className="text-xs font-bold">🎒 42 left</span>
                  <span className="text-lg" title="Settings">⚙️</span>
                </>
              }
            />
            <div className="p-3 text-xs opacity-70">
              ↑ This is what the board header looks like during active play.
            </div>
          </div>
        </Section>

        <Section title="📐 Lobby shell (live demo, scaled)">
          <p className="text-xs opacity-70 mb-3">
            Wraps header + cards in the canonical lobby layout. Mobile
            column, max-w-480, gradient background.
          </p>
          <div className="border border-dashed border-purple-300 rounded-xl overflow-hidden h-96 overflow-y-auto">
            <SQLobbyShell
              header={
                <SQLobbyHeader
                  title="Wordy"
                  avatarSlot={
                    <div className="w-9 h-9 rounded-full bg-wordy-500 text-white flex items-center justify-center font-bold text-sm shrink-0">
                      R
                    </div>
                  }
                  rightSlot={
                    <div className="flex items-center gap-3 shrink-0 text-2xl">
                      <span>🏠</span>
                      <span className="text-lg">⚙️</span>
                    </div>
                  }
                />
              }
            >
              <SQCard>
                <h3 className="font-display text-lg mb-2">🌸 New Game</h3>
                <p className="text-sm mb-3">2–4 players · solo also OK</p>
                <SQButton>Create Game</SQButton>
              </SQCard>
              <SQCard>
                <h3 className="font-display text-lg mb-2">🎮 Multiplayer</h3>
                <p className="text-sm opacity-70">No active games right now.</p>
              </SQCard>
              <SQCompletedGamesCard />
            </SQLobbyShell>
          </div>
        </Section>

        <Section title="📐 Board shell (live demo, scaled)">
          <p className="text-xs opacity-70 mb-3">
            Stacks two headers: <b>SQLobbyHeader</b> banner on top
            (avatar / game title / 🏠 / ⚙️), <b>SQBoardHeader</b> plain
            inline row beneath (← Lobby + one game badge). Live status
            (whose turn) lives in the score panel, not the sub-header.
          </p>
          <div className="border border-dashed border-purple-300 rounded-xl overflow-hidden h-96">
            <SQBoardShell
              header={
                <SQLobbyHeader
                  title="Wordy"
                  avatarSlot={
                    <div className="w-9 h-9 rounded-full bg-wordy-500 text-white flex items-center justify-center font-bold text-sm shrink-0">
                      R
                    </div>
                  }
                  rightSlot={
                    <div className="flex items-center gap-3 shrink-0 text-2xl">
                      <span>🏠</span>
                      <span className="text-lg">⚙️</span>
                    </div>
                  }
                />
              }
              subHeader={
                <SQBoardHeader
                  rightSlot={
                    <span className="text-xs font-bold">🎒 42 left</span>
                  }
                />
              }
              actionBar={
                <div className="px-3 py-3 flex items-center justify-center gap-2">
                  <SQButton>Submit</SQButton>
                  <SQButton variant="secondary">Recall</SQButton>
                  <SQButton variant="secondary">Swap</SQButton>
                  <SQButton variant="secondary">Pass</SQButton>
                </div>
              }
            >
              <div className="font-display text-lg opacity-50">
                [play area]
              </div>
            </SQBoardShell>
          </div>
        </Section>

        <Section title="🔠 Tiles">
          <p className="text-xs opacity-70 mb-3">
            Letter tile primitive. States: default / selected / placed /
            disabled. Hover the default tiles to see the lift.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col items-center gap-1">
              <SQTile letter="A" value={1} />
              <span className="text-xs opacity-70">default</span>
            </div>
            <div className="flex flex-col items-center gap-1">
              <SQTile letter="B" value={3} state="selected" />
              <span className="text-xs opacity-70">selected</span>
            </div>
            <div className="flex flex-col items-center gap-1">
              <SQTile letter="C" value={3} state="placed" />
              <span className="text-xs opacity-70">placed</span>
            </div>
            <div className="flex flex-col items-center gap-1">
              <SQTile letter="D" value={2} state="disabled" />
              <span className="text-xs opacity-70">disabled</span>
            </div>
          </div>
          <p className="text-xs opacity-70 mt-3">A full rack:</p>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {['W', 'O', 'R', 'D', 'Y', 'X', 'Z'].map((l, i) => (
              <SQTile
                key={l}
                letter={l}
                value={i === 5 ? 8 : 1}
                state={i === 2 ? 'selected' : 'default'}
              />
            ))}
          </div>
        </Section>

        <Section title="📜 Modal">
          <p className="text-xs opacity-70 mb-3">
            Backdrop click and Escape both close. Click below to open.
          </p>
          <SQButton onClick={() => setModalOpen(true)}>Open modal</SQButton>
          <SQModal
            open={modalOpen}
            onClose={() => setModalOpen(false)}
            title="Forfeit this game?"
            actions={
              <>
                <SQButton variant="secondary" onClick={() => setModalOpen(false)}>
                  Keep playing
                </SQButton>
                <SQButton variant="danger" onClick={() => setModalOpen(false)}>
                  Forfeit
                </SQButton>
              </>
            }
          >
            <p className="text-sm">
              You'll lose your current score and the other players will be
              notified. This can't be undone.
            </p>
          </SQModal>
        </Section>

        <Section title="📋 Dropdown + settings menu">
          <p className="text-xs opacity-70 mb-3">
            Floating panel with the standard settings rows. Click to toggle;
            outside click and Escape both close.
          </p>
          <div className="relative inline-block">
            <button
              type="button"
              onClick={() => setDropdownOpen((v) => !v)}
              className="text-2xl hover:scale-110 transition-transform"
              title="Settings"
            >
              ⚙️
            </button>
            <SQDropdown
              open={dropdownOpen}
              onClose={() => setDropdownOpen(false)}
              align="left"
            >
              <SQSettingsSection>
                <div className="flex items-center gap-2">
                  <div className="w-9 h-9 rounded-full bg-wordy-500 text-white flex items-center justify-center font-bold text-sm">
                    R
                  </div>
                  <div className="flex flex-col">
                    <span className="font-bold text-sm">Rae</span>
                    <span className="text-xs opacity-70">Your profile</span>
                  </div>
                </div>
              </SQSettingsSection>
              <SQSettingsRow label="🌙 Dark mode" control={<span>{isDark ? 'On' : 'Off'}</span>} onClick={toggle} />
              <SQSettingsRow label="🛡️ Admin" onClick={() => {}} />
              <SQSettingsRow label="🚪 Log out" danger onClick={() => {}} />
            </SQDropdown>
          </div>
        </Section>

        <SQCard>
          <p className="text-xs opacity-70">
            Stage 3 complete. The package now ships every primitive needed
            to scaffold a new SideQuest game. Next up: migrate Wordy onto
            sq-ui as the first proof.
          </p>
        </SQCard>
      </main>
    </div>
  );
}
