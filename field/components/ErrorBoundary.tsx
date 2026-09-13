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
        <div className="rounded-2xl border border-red-500/25 bg-red-950/20 p-4 text-center space-y-2">
          <div className="text-xs font-bold text-red-300">{this.props.label ?? 'View'} crashed — app is safe</div>
          <div className="text-[11px] font-mono text-white/40 truncate">{this.state.error}</div>
          <button
            onClick={() => this.setState({ error: null })}
            className="px-3.5 py-1.5 rounded-xl bg-teal-500 hover:bg-teal-400 text-white text-xs font-bold transition"
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
