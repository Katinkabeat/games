// React error boundary for SideQuest surfaces. Catches render/lifecycle
// errors in its subtree and shows a friendly, on-brand fallback instead of a
// blank screen. Boundaries must be class components — React 18 has no hook
// equivalent for getDerivedStateFromError / componentDidCatch.
//
// variant="page"   — full-screen fallback (game shells, hub root).
// variant="inline" — fallback sits in place as a card (hub grid, banners).
import { Component } from 'react';

export default class SQErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // No telemetry pipeline yet; the console is the only sink.
    console.error(`[SQErrorBoundary${this.props.label ? `:${this.props.label}` : ''}]`, error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;

    const inline = this.props.variant === 'inline';
    const title = this.props.title || 'Something went wrong';

    const panel = (
      <div className="card p-8 text-center max-w-[420px] w-full">
        <h2 className="font-display text-xl text-wordy-800 dark:text-wordy-100 mb-2">
          {title}
        </h2>
        <p className="font-body text-sm text-wordy-600 dark:text-wordy-300 mb-6">
          This part of SideQuest hit a snag. Your progress is safe — try again, or
          reload to get back on track.
        </p>
        <div className="flex gap-3 justify-center">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => this.setState({ error: null })}
          >
            Try again
          </button>
          <button type="button" className="btn-primary" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      </div>
    );

    if (inline) {
      return <div className="flex justify-center px-4 py-6">{panel}</div>;
    }
    return <div className="min-h-screen flex items-center justify-center px-4">{panel}</div>;
  }
}
