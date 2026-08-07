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

  private reset = (): void => {
    this.setState({ error: null, componentStack: null });
  };

  render(): ReactNode {
    const { error, componentStack } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <div className="w-full max-w-2xl rounded-lg border border-destructive/40 bg-card p-6 shadow-sm">
          <h1 className="text-lg font-semibold text-foreground">Something went wrong</h1>

          {import.meta.env.DEV ? (
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
            <button
              onClick={this.reset}
              className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              Try again
            </button>
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
