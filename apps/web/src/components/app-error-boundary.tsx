import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = {
  children: ReactNode;
};

type State = {
  error: Error | null;
};

/**
 * Visible boot-time error UI. Without this, uncaught render errors produce a
 * blank Capacitor WebView (white screen) with no recovery path.
 */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("AppErrorBoundary", error, info.componentStack);
  }

  private reload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;

    const message = this.state.error.message || "Unknown error";
    return (
      <div
        role="alert"
        style={{
          minHeight: "100dvh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 16,
          padding: 24,
          fontFamily: "system-ui, sans-serif",
          background: "#fff7ed",
          color: "#9a3412",
          textAlign: "center",
        }}
      >
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>
          Something went wrong
        </h1>
        <p style={{ margin: 0, maxWidth: 420, lineHeight: 1.5, color: "#7c2d12" }}>
          The app hit an error while starting. Tap reload — if it keeps happening,
          clear the app cache or reinstall from Play Closed testing.
        </p>
        <pre
          style={{
            margin: 0,
            maxWidth: "100%",
            overflow: "auto",
            padding: 12,
            borderRadius: 8,
            background: "#ffedd5",
            fontSize: 12,
            textAlign: "left",
          }}
        >
          {message}
        </pre>
        <button
          type="button"
          onClick={this.reload}
          style={{
            marginTop: 8,
            padding: "12px 20px",
            borderRadius: 10,
            border: "none",
            background: "#ea580c",
            color: "#fff",
            fontWeight: 600,
            fontSize: 15,
            cursor: "pointer",
          }}
        >
          Reload
        </button>
      </div>
    );
  }
}
