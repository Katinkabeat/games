// Central config for the notifications panel. Single source of truth
// for which apps + topics exist and how they show in the UI.
//
// To add a new game: append a row to APPS. To add a new topic for
// an existing game: extend its `topics` list. The Postgres-side
// default-resolver (sq_notification_default) is the authority on
// opt-in defaults; this file is just labels.

export const APPS = [
  {
    key: 'wordy',
    label: 'Wordy',
    icon: 'W',
    gradient: 'from-wordy-600 to-wordy-800',
    topics: ['your_turn', 'invite', 'nudge', 'opponent_joined', 'solo_turn', 'invite_declined'],
  },
  {
    key: 'rungles',
    label: 'Rungles',
    icon: 'R',
    gradient: 'from-wordy-600 to-wordy-800',
    topics: ['your_turn', 'invite', 'nudge', 'opponent_joined', 'invite_declined'],
  },
  {
    key: 'snibble',
    label: 'Snibble',
    icon: 'S',
    gradient: 'from-wordy-600 to-wordy-800',
    topics: ['your_turn', 'invite', 'nudge', 'opponent_joined', 'invite_declined'],
  },
  {
    key: 'yahdle',
    label: 'Yahdle',
    icon: 'Y',
    gradient: 'from-wordy-600 to-wordy-800',
    topics: ['your_turn', 'invite', 'opponent_joined', 'game_finished', 'invite_declined'],
  },
  {
    key: 'sidequest',
    label: 'SideQuest',
    icon: '🎯',
    gradient: 'from-wordy-600 to-wordy-800',
    topics: ['friend_request', 'daily_reminder'],
  },
];

// Display label + short description per topic. Descriptions appear
// in a smaller line under the toggle row.
export const TOPICS = {
  your_turn:       { label: 'Your turn',      description: 'Your opponent played; you’re up.' },
  invite:          { label: 'Game invites',   description: 'A friend invited you to a match.' },
  nudge:           { label: 'Nudges',         description: 'A friend pinged you to take your turn.' },
  opponent_joined: { label: 'Opponent joined', description: 'Someone joined a match you started.' },
  friend_request:  { label: 'Friend requests', description: 'Someone wants to be friends.' },
  game_finished:   { label: 'Game finished',   description: 'A match you’re in just ended.' },
  daily_reminder:  { label: 'Daily reminder',  description: 'One ping per day if you have unplayed dailies (Yahdle, Snibble, etc.).' },
  solo_turn:       { label: 'Solo game turns', description: 'When a computer player has moved in your Solo game. Off by default.' },
  invite_declined: { label: 'Invite couldn’t fill', description: 'When a game you started couldn’t fill because an invited friend didn’t join. Off by default.' },
};
