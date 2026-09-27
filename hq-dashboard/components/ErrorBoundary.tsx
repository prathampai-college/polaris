'use client';
import React from 'react';

type Props = { children: React.ReactNode; label?: string };
type State = { error: string | null };

/** Isolates WebGL/Leaflet crashes to a retry card instead of a blank app. */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };
  static getDerivedStateFromError(e: unknown): State {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  componentDidCatch(e: unknown) {
    try {
      console.error(`[boundary:${this.props.label ?? 'app'}]`, e);
    } catch {}
  }
  render() {
    if (this.state.error) {
      return (
        <div className="border border-flare/40 bg-flare/5 p-4 text-center space-y-2">
          <div className="text-xs font-bold text-flare">{this.props.label ?? 'View'} crashed — app is safe</div>
          <div className="truncate font-mono text-[11px] text-slate">{this.state.error}</div>
          <button
            onClick={() => this.setState({ error: null })}
            className="border border-structure bg-cobalt px-3.5 py-1.5 font-mono text-xs font-bold text-white hover:bg-structure"
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
