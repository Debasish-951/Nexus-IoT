import { useState, useRef, useEffect, useCallback } from "react";
import { useCurrentUser } from "@/contexts/UserContext";
import { useListUsers } from "@workspace/api-client-react";
import {
  User2, KeyRound, LogOut, ChevronDown, Check, ArrowLeftRight, Eye, EyeOff,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";

const ROLE_COLORS: Record<string, string> = {
  admin:    "bg-purple-100 text-purple-700",
  engineer: "bg-blue-100   text-blue-700",
  operator: "bg-green-100  text-green-700",
  viewer:   "bg-gray-100   text-gray-600",
};

export default function UserProfileTopMenu() {
  const { currentUser, setCurrentUser, can } = useCurrentUser();
  const { data: users } = useListUsers();
  const userList = (users as any[] | undefined) ?? [];

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

  function handleSignOut() {
    setCurrentUser(null);
    setOpen(false);
  }

  function handleSwitchUser(u: any) {
    setCurrentUser({ id: u.id, fullName: u.fullName, email: u.email, role: u.role });
    setOpen(false);
  }

  const otherUsers = userList.filter((u: any) => u.id !== currentUser.id);

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
          <div className="hidden sm:block text-left">
            <p className="text-xs font-medium leading-tight max-w-[120px] truncate">{displayName}</p>
            <p className="text-[10px] text-muted-foreground leading-tight capitalize">{currentUser.role}</p>
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
                <div className="min-w-0">
                  <p className="text-sm font-semibold truncate">{displayName}</p>
                  <p className="text-xs text-muted-foreground truncate">{currentUser.email}</p>
                  <span className={cn(
                    "inline-block mt-1 text-[10px] px-2 py-0.5 rounded-full font-medium capitalize",
                    ROLE_COLORS[currentUser.role]
                  )}>
                    {currentUser.role}
                  </span>
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

            {/* Switch user */}
            {otherUsers.length > 0 && (
              <div className="border-t border-border py-1">
                <p className="px-4 py-1.5 text-[10px] text-muted-foreground font-medium uppercase tracking-wide">
                  Switch Profile
                </p>
                {otherUsers.map((u: any) => {
                  const uName = u.fullName ?? u.username ?? "User";
                  const uInitials = uName.split(" ").map((w: string) => w[0] ?? "").join("").toUpperCase().slice(0, 2) || "U";
                  return (
                    <button
                      key={u.id}
                      onClick={() => handleSwitchUser(u)}
                      className="w-full flex items-center gap-2.5 px-4 py-2 text-sm hover:bg-muted transition-colors text-left"
                    >
                      <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center text-[10px] font-bold shrink-0">
                        {uInitials}
                      </div>
                      <span className="flex-1 truncate text-xs">{uName}</span>
                      <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full capitalize", ROLE_COLORS[u.role])}>
                        {u.role}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

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
  open, onClose, userId, userName,
}: {
  open: boolean; onClose: () => void; userId: string; userName: string;
}) {
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

    if (next.length < 6) {
      setError("New password must be at least 6 characters."); return;
    }
    if (next !== confirm) {
      setError("New passwords do not match."); return;
    }

    setLoading(true);
    try {
      const res = await fetch(`/api/users/${userId}/change-password`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Password change failed.");
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
                  placeholder="Min. 6 characters"
                  required
                  className="pr-9 h-9 text-sm"
                />
                <button type="button" onClick={() => setShowNext((s) => !s)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  {showNext ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
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
