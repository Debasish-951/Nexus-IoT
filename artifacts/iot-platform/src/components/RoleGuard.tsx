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
}

export function RoleGuard({ permission, children, mode = "hide", className }: RoleGuardProps) {
  const { can, currentUser } = useCurrentUser();
  if (can(permission)) return <>{children}</>;
  if (mode === "hide") return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className={cn("cursor-not-allowed opacity-40 pointer-events-none select-none", className)}>
          {children}
        </div>
      </TooltipTrigger>
      <TooltipContent side="top" className="flex items-center gap-1.5 text-xs">
        <Lock className="w-3 h-3 shrink-0" />
        <span>
          Your role <strong>({currentUser?.role})</strong> cannot perform this action
        </span>
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Shows an amber read-only banner when the user lacks a permission.
 * Renders nothing when they have access.
 */
export function ReadOnlyBanner({ permission, message }: { permission: string; message?: string }) {
  const { can, currentUser } = useCurrentUser();
  if (can(permission)) return null;
  return (
    <div className="flex items-center gap-2.5 rounded-md border border-amber-200 dark:border-amber-800/40 bg-amber-50 dark:bg-amber-950/20 px-3 py-2.5 text-xs text-amber-800 dark:text-amber-300">
      <Lock className="w-3.5 h-3.5 shrink-0" />
      <span>
        <strong>Read-only access</strong> — your role (<code className="bg-amber-100 dark:bg-amber-900 px-1 rounded">{currentUser?.role}</code>){" "}
        {message ?? "cannot make changes to this section. Contact an Administrator to request elevated access."}
      </span>
    </div>
  );
}
