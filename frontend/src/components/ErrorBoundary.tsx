import { Component, type ErrorInfo, type ReactNode } from "react";

interface State { error: Error | null }

export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, State> {
  state: State = { error: null };
  static getDerivedStateFromError(error: Error): State {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Page error", error, info.componentStack);
  }
  componentDidUpdate(prev: { resetKey?: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }
  render() {
    if (this.state.error) {
      return (
        <div className="card" style={{ margin: 20 }}>
          <h2>Something went wrong on this page</h2>
          <div className="errorbox mt-2">{this.state.error.message}</div>
          <button className="btn mt-2" onClick={() => this.setState({ error: null })}>Try again</button>
        </div>
      );
    }
    return this.props.children;
  }
}
