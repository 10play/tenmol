/**
 * One broken feature must not blank the application.
 *
 * React only offers error boundaries as class components; this is the whole
 * reason there is a class in this codebase. The boundary reports into the
 * console feature as well as rendering, because a scientific tool that silently
 * loses a panel is worse than one that says which panel it lost.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  /** Shown in the failure box. */
  label: string;
  children: ReactNode;
  onError?: (error: Error, info: ErrorInfo) => void;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    this.props.onError?.(error, info);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="feature-failed" role="alert">
        <div className="feature-failed__title">{this.props.label} failed</div>
        <div className="feature-failed__message">{error.message}</div>
        <button
          type="button"
          className="feature-failed__retry"
          onClick={() => this.setState({ error: null })}
        >
          retry
        </button>
      </div>
    );
  }
}
