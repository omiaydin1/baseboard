"use client";

import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  message?: string;
}

/**
 * App-level error boundary. A render error after a transaction settles (e.g. a
 * transient state-hydration glitch on mobile / the BaseApp webview) would
 * otherwise unmount the whole tree and leave a persistent white screen that
 * needs a hard app restart. This catches it and shows a recoverable fallback so
 * the user can re-hydrate the UI with a single tap — no restart required.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: unknown): State {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : String(error),
    };
  }

  componentDidCatch(error: unknown) {
    // Surface for diagnostics without crashing the app.
    console.error("[BaseBoard] recovered from a render error:", error);
  }

  private reset = () => this.setState({ hasError: false, message: undefined });

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-white p-6 text-center">
        <div className="max-w-sm space-y-3">
          <h1 className="text-xl font-black text-base-blue">
            Something glitched
          </h1>
          <p className="text-sm text-slate-600">
            The board hit a temporary hiccup updating after your last action.
            Tap below to refresh — your wallet and plots are safe.
          </p>
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={this.reset}
              className="rounded-xl bg-base-blue px-4 py-2.5 font-bold text-white hover:bg-base-dark"
            >
              Try again
            </button>
            <button
              type="button"
              onClick={() => {
                if (typeof window !== "undefined") window.location.reload();
              }}
              className="rounded-xl border-2 border-base-blue px-4 py-2.5 font-semibold text-base-blue hover:bg-blue-50"
            >
              Reload app
            </button>
          </div>
        </div>
      </div>
    );
  }
}
