'use client';
import React from 'react';

type Props = { children: React.ReactNode; label?: string };
type State = { error: string | null };

/** Isolates a crashing view (WebGL, camera, bad row) to a retry card — the rest of the app keeps working. */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };
  static getDerivedStateFromError(e: unknown): State {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  componentDidCatch(e: unknown) {
    console.error(`[boundary:${this.props.label ?? 'app'}]`, e);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="space-y-3 border border-flare bg-flare/10 p-5">
        <div className="font-mono text-sm font-semibold text-flare">{this.props.label ?? 'View'} failed — your data is safe</div>
        <div className="truncate font-mono text-xs text-slate">{this.state.error}</div>
        <button type="button" onClick={() => this.setState({ error: null })} className="min-h-tap border border-structure bg-ink px-4 font-mono text-sm font-semibold text-canvas hover:bg-structure">
          Retry
        </button>
      </div>
    );
  }
}
