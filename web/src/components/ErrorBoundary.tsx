import { Component, type ErrorInfo, type ReactNode } from "react";

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[APP CRASH]", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="rounded-2xl border border-danger/30 bg-danger/10 p-4 text-sm">
          <div className="font-medium text-danger">Render crashed: {this.state.error.message}</div>
          <pre className="mt-2 whitespace-pre-wrap text-xs text-ink/70">{this.state.error.stack}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}
