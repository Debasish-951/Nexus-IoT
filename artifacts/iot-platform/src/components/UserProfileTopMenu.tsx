import { useState, useRef, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { useCurrentUser } from "@/contexts/UserContext";
import {
  KeyRound, LogOut, ChevronDown, Check, Eye, EyeOff,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { apiPost, usePasswordPolicy, validatePasswordAgainst } from "@/lib/auth-api";
import { PasswordChecklist, PasswordStrengthMeter } from "@/components/PasswordFields";

const APP_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export default function UserProfileTopMenu() {
  const { currentUser, logout } = useCurrentUser();
  const [, navigate] = useLocation();

  const [open, setOpen] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  if (!currentUser) return null;

  const displayName = currentUser.fullName ?? currentUser.email ?? "User";
  const initials = displayName
    .split(" ").map((w: string) => w[0] ?? "").join("").toUpperCase().slice(0, 2) || "U";

  // Signing out now revokes the session server-side, so the cookie cannot be
  // replayed. Navigation happens regardless of whether the call succeeds.
  async function handleSignOut() {
    setOpen(false);
    await logout();
    // `~` escapes the router base. This menu renders inside the project
    // workspace, whose router is based at /p/<projectId>, so a plain
    // navigate("/login") would sign the user out and then send them to
    // /p/<projectId>/login — a 404. APP_BASE is re-applied so a subpath
    // deployment still reaches its own login page.
    navigate(`~${APP_BASE}/login`);
  }

  return (
    <>
      <div className="relative" ref={dropdownRef}>
        <button
          onClick={() => setOpen((o) => !o)}
          className={cn(
            "flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-muted transition-colors",
            open && "bg-muted"
          )}
        >
          <div className="w-7 h-7 rounded-full bg-primary flex items-center justify-center text-white text-xs font-bold shrink-0">
            {initials}
          </div>
          {/* Name only. Role is not surfaced to the user anywhere in the
              product — access is assigned by an administrator, and putting a
              privilege level on permanent display tells anyone glancing at the
              screen how valuable the session is. */}
          <div className="hidden sm:block text-left">
            <p className="text-sm font-medium leading-tight max-w-[140px] truncate">{displayName}</p>
          </div>
          <ChevronDown className={cn("w-3.5 h-3.5 text-muted-foreground transition-transform hidden sm:block", open && "rotate-180")} />
        </button>

        {open && (
          <div className="absolute right-0 top-11 w-72 rounded-xl border border-border bg-popover shadow-xl z-50 overflow-hidden">
            {/* User header */}
            <div className="px-4 py-3 border-b border-border bg-muted/30">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center text-white text-sm font-bold shrink-0">
                  {initials}
                </div>
                {/* Name and email only — the role badge is intentionally gone.
                    Users are not told their own role anywhere in the product;
                    access is assigned by an administrator. */}
                <div className="min-w-0">
                  <p className="text-sm font-semibold truncate">{displayName}</p>
                  <p className="text-xs text-muted-foreground truncate">{currentUser.email}</p>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="py-1">
              <button
                onClick={() => { setShowPasswordModal(true); setOpen(false); }}
                className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm hover:bg-muted transition-colors text-left"
              >
                <KeyRound className="w-4 h-4 text-muted-foreground" />
                Change Password
              </button>
            </div>

            {/* Sign out */}
            <div className="border-t border-border py-1">
              <button
                onClick={handleSignOut}
                className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-destructive hover:bg-destructive/10 transition-colors text-left"
              >
                <LogOut className="w-4 h-4" />
                Sign Out
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Change Password Modal */}
      <ChangePasswordModal
        open={showPasswordModal}
        onClose={() => setShowPasswordModal(false)}
        userId={currentUser.id}
        userName={displayName}
      />
    </>
  );
}

function ChangePasswordModal({
  open, onClose, userName,
}: {
  open: boolean; onClose: () => void; userId: string; userName: string;
}) {
  const policy = usePasswordPolicy();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNext, setShowNext] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  function reset() {
    setCurrent(""); setNext(""); setConfirm("");
    setError(null); setSuccess(false); setLoading(false);
    setShowCurrent(false); setShowNext(false);
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (next !== confirm) {
      setError("New passwords do not match."); return;
    }
    // Client-side policy check is UX only — the server re-validates and is the
    // authority. Keeping the check here just avoids a round trip.
    const violations = validatePasswordAgainst(next, policy);
    if (violations.length > 0) { setError(violations[0]); return; }

    setLoading(true);
    try {
      // Was PATCH /users/:id/change-password, which took the target from the URL
      // and authorised nothing — any caller could change any user's password.
      // This endpoint has no :id: it only ever changes your own.
      const res = await apiPost("/api/auth/change-password", {
        currentPassword: current,
        newPassword: next,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.violations?.[0] ?? body.error ?? "Password change failed.");
      } else {
        setSuccess(true);
        setTimeout(() => { handleClose(); }, 1800);
      }
    } catch {
      setError("Network error — please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="w-4 h-4" /> Change Password
          </DialogTitle>
        </DialogHeader>

        {success ? (
          <div className="flex flex-col items-center gap-3 py-6">
            <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center">
              <Check className="w-6 h-6 text-green-600" />
            </div>
            <p className="text-sm font-medium text-green-700">Password changed successfully</p>
            <p className="text-xs text-muted-foreground">You have been signed out on all other devices.</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 pt-2">
            <p className="text-xs text-muted-foreground">Changing password for <strong>{userName}</strong></p>

            <div className="space-y-1.5">
              <Label className="text-xs">Current Password</Label>
              <div className="relative">
                <Input
                  type={showCurrent ? "text" : "password"}
                  value={current}
                  onChange={(e) => setCurrent(e.target.value)}
                  placeholder="Enter current password"
                  required
                  className="pr-9 h-9 text-sm"
                />
                <button type="button" onClick={() => setShowCurrent((s) => !s)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  {showCurrent ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">New Password</Label>
              <div className="relative">
                <Input
                  type={showNext ? "text" : "password"}
                  value={next}
                  onChange={(e) => setNext(e.target.value)}
                  placeholder={`Min. ${policy.minLength} characters`}
                  autoComplete="new-password"
                  required
                  className="pr-9 h-9 text-sm"
                />
                <button type="button" onClick={() => setShowNext((s) => !s)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  {showNext ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {/* Same checklist the activation and reset pages show, driven by
                  the policy the server actually enforces. */}
              <PasswordStrengthMeter password={next} policy={policy} />
              {next && <PasswordChecklist password={next} policy={policy} className="pt-1" />}
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Confirm New Password</Label>
              <Input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Repeat new password"
                required
                className="h-9 text-sm"
              />
            </div>

            {error && (
              <p className="text-xs text-destructive bg-destructive/10 rounded px-3 py-2">{error}</p>
            )}

            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" size="sm" onClick={handleClose} disabled={loading}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={loading || !current || !next || !confirm}>
                {loading ? "Saving…" : "Change Password"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
