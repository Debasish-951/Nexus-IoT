import * as React from "react"

import { cn } from "@/lib/utils"

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  // Browser form-history autofill defaults to OFF: these are asset/template/project
  // names and search boxes, not a login form, and Chrome's per-field memory kept
  // suggesting values (including ones already deleted from the app) under a stale
  // dropdown that looked like an unstyled leftover. A caller that genuinely wants
  // native autofill — Login's username/current-password, a new-password field —
  // passes its own `autoComplete` prop, which wins because it's destructured
  // before the default is applied here.
  ({ className, type, autoComplete = "off", ...props }, ref) => {
    return (
      <input
        type={type}
        autoComplete={autoComplete}
        className={cn(
          "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
