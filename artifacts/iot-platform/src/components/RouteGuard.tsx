import { useEffect } from "react";
import { useLocation } from "wouter";
import { Loader2, ShieldOff } from "lucide-react";
import { useCurrentUser } from "@/contexts/UserContext";
import { Button } from "@/components/ui/button";
import ForcePasswordChange from "@/pages/ForcePasswordChange";

/**
 * Route-level access control.
 *
 * The previous gate was `localStorage.getItem("ws_authed") === "1"` — a value
 * anyone could set from devtools. Authentication is now decided by the server's
 * answer to /auth/session, and the module grant decides which routes render.
 *
 * This is defence in depth, not the control itself: the API enforces the same
 * rules independently, so bypassing this only produces a page full of 403s.
 */

function Splash({ label }: { label: string }) {
  return (
    <div className="flex min-h-[60vh] w-full items-center justify-center">
      <div className="flex items-center gap-3 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span className="text-sm">{label}</span>
      </div>
    </div>
  );
}

/** Shown instead of a blank screen when a user reaches a route they cannot use. */
export function Forbidden({ module }: { module?: string }) {
  const [, navigate] = useLocation();
  const { currentUser } = useCurrentUser();

  return (
    <div className="flex min-h-[60vh] w-full items-center justify-center p-6">
      <div className="max-w-md text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-muted">
          <ShieldOff className="h-6 w-6 text-muted-foreground" />
        </div>
        <h1 className="mt-5 text-xl font-semibold">Access restricted</h1>
        {/* No role name — consistent with the rest of the product. */}
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          You do not have access to {module ? "this module" : "this page"}.
          Contact an administrator if you need it.
        </p>
        <Button variant="outline" size="sm" className="mt-6" onClick={() => navigate("/")}>
          Back to dashboard
        </Button>
      </div>
    </div>
  );
}

/**
 * Requires an authenticated session. Redirects to /login otherwise.
 * `module` additionally requires the corresponding grant.
 */
export function Protected({
  children, module, level = "read",
}: {
  children: React.ReactNode;
  module?: string;
  level?: "read" | "write" | "delete";
}) {
  const { currentUser, loading, canModule } = useCurrentUser();
  const [location, navigate] = useLocation();

  useEffect(() => {
    if (loading || currentUser) return;
    // Preserve where they were headed so login can return them there.
    const next = location !== "/" ? `?next=${encodeURIComponent(location)}` : "";
    navigate(`/login${next}`, { replace: true });
  }, [loading, currentUser, location, navigate]);

  // Never redirect while the session probe is in flight — a hard refresh would
  // otherwise bounce an authenticated user to /login before the cookie resolves.
  if (loading) return <Splash label="Restoring your session…" />;
  if (!currentUser) return <Splash label="Redirecting to sign in…" />;

  // Signed in on a temporary password: the API refuses everything except the
  // change-password endpoint, so render that instead of the requested page.
  if (currentUser.mustChangePassword) return <ForcePasswordChange />;

  if (module && !canModule(module, level)) return <Forbidden module={module} />;

  return <>{children}</>;
}
