import { useState } from "react";
import { Eye, EyeOff, Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { passwordRules, passwordStrength, type PasswordPolicy } from "@/lib/auth-api";

/**
 * Shared password-entry UI for activation, reset, and change-password.
 *
 * One component so the three flows cannot drift into showing three different
 * sets of rules — and so the rules shown always come from the policy the server
 * actually enforces.
 */

const METER_COLORS = ["bg-slate-300", "bg-red-500", "bg-amber-500", "bg-lime-500", "bg-emerald-500"];

export function PasswordStrengthMeter({ password, policy }: { password: string; policy: PasswordPolicy }) {
  const { score, label } = passwordStrength(password, policy);
  if (!password) return null;

  return (
    <div className="space-y-1.5">
      <div className="flex gap-1" role="img" aria-label={`Password strength: ${label}`}>
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className={cn("h-1 flex-1 rounded-full transition-colors",
            i <= score ? METER_COLORS[score] : "bg-muted")} />
        ))}
      </div>
      <p className={cn("text-[11px] font-medium",
        score >= 3 ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")}>
        {label}
      </p>
    </div>
  );
}

export function PasswordChecklist({
  password, policy, className,
}: { password: string; policy: PasswordPolicy; className?: string }) {
  const rules = passwordRules(password, policy);

  return (
    <ul className={cn("space-y-1", className)} aria-label="Password requirements">
      {rules.map((rule) => (
        <li key={rule.label} className="flex items-center gap-1.5 text-[11px]">
          {rule.met
            ? <Check className="h-3 w-3 shrink-0 text-emerald-500" aria-hidden />
            : <X className="h-3 w-3 shrink-0 text-muted-foreground/50" aria-hidden />}
          <span className={rule.met ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}>
            {rule.label}
          </span>
          <span className="sr-only">{rule.met ? "met" : "not met"}</span>
        </li>
      ))}
      {policy.blockCommon && (
        <li className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="h-3 w-3 shrink-0" aria-hidden />
          Checked against common and breached passwords
        </li>
      )}
    </ul>
  );
}

interface PasswordInputProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
  autoFocus?: boolean;
  placeholder?: string;
  className?: string;
  /** Applied to the <Input> — lets the dark login theme reuse this. */
  inputClassName?: string;
  error?: boolean;
}

export function PasswordInput({
  id, label, value, onChange, autoComplete = "new-password",
  autoFocus, placeholder = "••••••••••••", className, inputClassName, error,
}: PasswordInputProps) {
  const [show, setShow] = useState(false);

  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={id} className="text-xs font-medium">{label}</Label>
      <div className="relative">
        <Input
          id={id}
          type={show ? "text" : "password"}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          required
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={error || undefined}
          className={cn("pr-10", inputClassName)}
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          aria-label={show ? "Hide password" : "Show password"}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        >
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}
