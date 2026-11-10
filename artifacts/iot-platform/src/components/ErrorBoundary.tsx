import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * Catches uncaught render errors and shows them on screen.
 *
 * Replaces the hosting platform's dev-time error modal, which was removed with the
 * rest of its tooling. Vite's own overlay only covers build and HMR failures — an
 * error thrown during React render produced a blank page and a console message
 * nobody was looking at, which is the gap this closes.
 *
 * Deliberately imports nothing from the app: no UI primitives, no router, no
 * context. A boundary that depends on the tree it is guarding can fail while
 * rendering its own fallback, and then there is nothing left to show.
 */

interface Props {
  children: ReactNode;
  /**
   * Where the boundary sits, which decides how much room the fallback takes:
   *   "app"    — the root boundary in main.tsx; fills the screen (default).
   *   "page"   — around the routed page, INSIDE Layout, so the sidebar and top
   *              bar survive a page that throws.
   *   "widget" — around one dashboard widget, so one bad widget does not take
   *              the rest of the dashboard with it.
   */
  scope?: "app" | "page" | "widget";
  /**
   * Clears a caught error when it changes — the route for a page boundary, the
   * widget object for a widget boundary — so navigating away or editing the
   * widget gets a fresh render instead of the stale fallback.
   */
  resetKey?: unknown;
}

/**
 * A lazily-loaded page chunk that failed to download. After a deploy the old
 * hashed file names are gone, and React caches the rejected import, so "Try
 * again" would only re-render the same failure — a full reload is what fetches
 * the new build's index and chunk names.
 */
function isChunkLoadError(error: Error): boolean {
  return error.name === "ChunkLoadError"
    || /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS/i
      .test(error.message ?? "");
}

interface State {
  error: Error | null;
  componentStack: string | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, componentStack: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Keep the console output too — it is what a stack-trace-in-devtools workflow
    // relies on, and it survives if the fallback below ever fails to render.
    console.error("Uncaught render error:", error, info.componentStack);
    this.setState({ componentStack: info.componentStack ?? null });
  }

  componentDidUpdate(prev: Props): void {
    if (this.state.error && !Object.is(prev.resetKey, this.props.resetKey)) this.reset();
  }

  private reset = (): void => {
    this.setState({ error: null, componentStack: null });
  };

  render(): ReactNode {
    const { error, componentStack } = this.state;
    if (!error) return this.props.children;

    const scope = this.props.scope ?? "app";
    const chunk = isChunkLoadError(error);

    if (scope === "widget") {
      return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 p-2 text-center">
          <p className="text-xs font-medium text-foreground">This widget could not be displayed</p>
          {import.meta.env.DEV && (
            <p className="max-w-full truncate text-[10px] text-muted-foreground" title={error.message}>{error.message}</p>
          )}
          <button
            onClick={chunk ? () => window.location.reload() : this.reset}
            className="h-6 rounded-md border border-input px-2 text-[11px] font-medium text-foreground hover:bg-muted"
          >
            {chunk ? "Reload page" : "Try again"}
          </button>
        </div>
      );
    }

    return (
      <div className={scope === "page"
        ? "flex min-h-[50vh] w-full items-center justify-center p-6"
        : "min-h-screen flex items-center justify-center bg-background p-6"}>
        <div className="w-full max-w-2xl rounded-lg border border-destructive/40 bg-card p-6 shadow-sm">
          <h1 className="text-lg font-semibold text-foreground">Something went wrong</h1>

          {chunk ? (
            <p className="mt-1 text-sm text-muted-foreground">
              This page could not be loaded, usually because a new version of the
              application has been installed. Reload to get the latest version.
            </p>
          ) : import.meta.env.DEV ? (
            <>
              <p className="mt-1 text-sm text-muted-foreground">
                An error was thrown while rendering. This detail is shown in development only.
              </p>
              <pre className="mt-4 max-h-64 overflow-auto rounded-md border border-border bg-muted/40 p-3 text-xs leading-relaxed text-foreground whitespace-pre-wrap">
                {error.message}
                {error.stack ? `\n\n${error.stack}` : ""}
              </pre>
              {componentStack && (
                <pre className="mt-2 max-h-48 overflow-auto rounded-md border border-border bg-muted/40 p-3 text-[11px] leading-relaxed text-muted-foreground whitespace-pre-wrap">
                  {componentStack}
                </pre>
              )}
            </>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">
              The page could not be displayed. Try again, and if it keeps happening
              contact your administrator.
            </p>
          )}

          <div className="mt-5 flex gap-2">
            {/* A failed chunk would fail again on re-render; only a reload helps. */}
            {!chunk && (
              <button
                onClick={this.reset}
                className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
              >
                Try again
              </button>
            )}
            <button
              onClick={() => window.location.reload()}
              className="h-9 rounded-md border border-input px-4 text-sm font-medium text-foreground hover:bg-muted"
            >
              Reload page
            </button>
          </div>
        </div>
      </div>
    );
  }
}
