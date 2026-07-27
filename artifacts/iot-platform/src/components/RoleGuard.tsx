import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useCurrentUser } from "@/contexts/UserContext";
import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Hides or disables children based on the current user's role.
 *
 * mode="hide"    — renders null when permission is denied (default)
 * mode="disable" — wraps children in a disabled container with a tooltip
 */
interface RoleGuardProps {
  permission: string;
  children: React.ReactNode;
  mode?: "hide" | "disable";
  className?: string;
  /**
   * Optional module grant that must ALSO be held. Use it where the role verb is
   * too coarse — e.g. an engineer has `manage_assets` by role, but an admin can
   * still switch off their `assets.d` circle, and the delete button should
   * disappear. The API applies the same pair of checks.
   */
  module?: string;
  level?: "read" | "write" | "delete";
}

export function RoleGuard({ permission, children, mode = "hide", className, module, level }: RoleGuardProps) {
  const { canAction } = useCurrentUser();
  if (canAction(permission, module, level ?? "read")) return <>{children}</>;
  if (mode === "hide") return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className={cn("cursor-not-allowed opacity-40 pointer-events-none select-none", className)}>
          {children}
        </div>
      </TooltipTrigger>
      {/* Deliberately does not name the user's role — see the note in
          UserProfileTopMenu. The user is told what they cannot do and who to
          ask, which is the actionable part; the role name is not. */}
      <TooltipContent side="top" className="flex items-center gap-1.5 text-xs">
        <Lock className="w-3 h-3 shrink-0" />
        <span>You do not have permission for this action</span>
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Shows an amber read-only banner when the user lacks a permission.
 * Renders nothing when they have access.
 */
export function ReadOnlyBanner({
  permission, message, module, level,
}: { permission: string; message?: string; module?: string; level?: "read" | "write" | "delete" }) {
  const { canAction } = useCurrentUser();
  if (canAction(permission, module, level ?? "write")) return null;
  return (
    <div className="flex items-center gap-2.5 rounded-md border border-amber-200 dark:border-amber-800/40 bg-amber-50 dark:bg-amber-950/20 px-3 py-2.5 text-xs text-amber-800 dark:text-amber-300">
      <Lock className="w-3.5 h-3.5 shrink-0" />
      <span>
        <strong>Read-only access</strong> —{" "}
        {message ?? "you cannot make changes to this section. Contact an Administrator to request access."}
      </span>
    </div>
  );
}
