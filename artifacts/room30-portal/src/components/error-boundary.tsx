import React from "react";

type Props = { children: React.ReactNode };
type State = { error: Error | null };

// sessionStorage key used to make sure we only auto-reload ONCE per tab for a
// given stale-bundle incident. Without this guard, if reloading does not
// actually fix the problem (e.g. real bug in the new bundle), the user would
// be stuck in a refresh loop.
const AUTO_RELOAD_KEY = "portal:autoReloadAttempt";

// Recognise the family of errors that almost always mean "the JS chunks the
// browser already had loaded are out of sync with what the server is now
// serving" - typically because a new deploy rolled out mid-session.
// Reloading the whole page fetches a fresh, internally-consistent bundle.
function isStaleBundleError(err: Error | null | undefined): boolean {
  if (!err) return false;
  const msg = (err.message || "").toLowerCase();
  const name = (err.name || "").toLowerCase();
  if (name === "chunkloaderror") return true;
  return (
    msg.includes("failed to fetch dynamically imported module") ||
    msg.includes("error loading dynamically imported module") ||
    msg.includes("importing a module script failed") ||
    msg.includes("loading chunk") ||
    msg.includes("loading css chunk") ||
    // TDZ errors that surface when a half-loaded module references a binding
    // that never finished initialising. Common signature on Vite-built bundles
    // when chunk hashes change underneath an open tab.
    msg.includes("cannot access") && msg.includes("before initialization")
  );
}

export class PortalErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[PortalErrorBoundary]", error, info?.componentStack);

    // Auto-reload once if this looks like a stale bundle from a fresh deploy.
    // We only do it a single time per tab so a real, persistent bug does not
    // trap the user in a refresh loop.
    if (isStaleBundleError(error)) {
      try {
        const already = sessionStorage.getItem(AUTO_RELOAD_KEY);
        if (!already) {
          sessionStorage.setItem(AUTO_RELOAD_KEY, String(Date.now()));
          // Bypass the HTTP cache so we definitely pick up the new index.html.
          window.location.reload();
          return;
        }
      } catch {
        // sessionStorage may be blocked (private mode etc). Fall through to
        // showing the manual reload UI rather than crashing harder.
      }
    } else {
      // Non-stale-bundle error. Clear any prior auto-reload marker so a
      // future legitimate stale-bundle incident in this tab can still get
      // the one-shot auto-reload treatment.
      try { sessionStorage.removeItem(AUTO_RELOAD_KEY); } catch {}
    }
  }

  handleReload = () => {
    try { sessionStorage.removeItem(AUTO_RELOAD_KEY); } catch {}
    this.setState({ error: null });
    window.location.reload();
  };

  handleHome = () => {
    this.setState({ error: null });
    window.location.assign(import.meta.env.BASE_URL || "/");
  };

  render() {
    if (!this.state.error) return this.props.children;

    const message = this.state.error?.message || "Something went wrong rendering this page.";

    return (
      <div
        style={{
          minHeight: "100vh",
          background: "#0a0a0a",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "24px",
          fontFamily: "Inter, system-ui, sans-serif",
        }}
      >
        <div
          style={{
            maxWidth: 480,
            width: "100%",
            background: "#1a1a1f",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 16,
            padding: "28px 28px 22px",
            color: "#fff",
            boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
          }}
        >
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: "50%",
              background: "rgba(201,164,76,0.15)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: 16,
              fontSize: 22,
              color: "#C9A44C",
              fontWeight: 700,
            }}
          >
            !
          </div>
          <h1
            style={{
              fontSize: 20,
              fontWeight: 800,
              textTransform: "uppercase",
              letterSpacing: "0.04em",
              margin: 0,
              marginBottom: 8,
              fontFamily: "var(--app-font-display, Inter, sans-serif)",
            }}
          >
            Page failed to load
          </h1>
          <p
            style={{
              fontSize: 13,
              color: "rgba(255,255,255,0.6)",
              lineHeight: 1.6,
              margin: 0,
              marginBottom: 16,
            }}
          >
            Something broke while loading this page. Try reloading. If it keeps happening, head back to the dashboard and let support know.
          </p>
          <pre
            style={{
              fontSize: 11,
              color: "rgba(255,255,255,0.4)",
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.06)",
              borderRadius: 8,
              padding: 10,
              overflow: "auto",
              maxHeight: 120,
              margin: 0,
              marginBottom: 16,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {message}
          </pre>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={this.handleReload}
              style={{
                flex: 1,
                padding: "12px 16px",
                borderRadius: 10,
                border: "none",
                background: "linear-gradient(135deg, #C9A44C 0%, #B8902F 100%)",
                color: "#fff",
                fontWeight: 800,
                fontSize: 12,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                cursor: "pointer",
                fontFamily: "var(--app-font-display, Inter, sans-serif)",
              }}
            >
              Reload page
            </button>
            <button
              onClick={this.handleHome}
              style={{
                flex: 1,
                padding: "12px 16px",
                borderRadius: 10,
                border: "1px solid rgba(255,255,255,0.12)",
                background: "rgba(255,255,255,0.04)",
                color: "rgba(255,255,255,0.75)",
                fontWeight: 800,
                fontSize: 12,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                cursor: "pointer",
                fontFamily: "var(--app-font-display, Inter, sans-serif)",
              }}
            >
              Go to dashboard
            </button>
          </div>
        </div>
      </div>
    );
  }
}
