import { useState, useEffect } from "react";
import { Sun, Moon } from "lucide-react";
import { cn } from "@/lib/utils";

function getInitial(): boolean {
  if (typeof document === "undefined") return false;
  return document.documentElement.classList.contains("dark");
}

export default function ThemeToggle() {
  const [dark, setDark] = useState(getInitial);

  useEffect(() => {
    const root = document.documentElement;
    if (dark) root.classList.add("dark");
    else root.classList.remove("dark");
    try {
      localStorage.setItem("theme", dark ? "dark" : "light");
    } catch {
      /* ignore storage errors */
    }
  }, [dark]);

  return (
    <button
      onClick={() => setDark((d) => !d)}
      title={dark ? "Switch to light mode" : "Switch to dark mode"}
      aria-label="Toggle theme"
      className={cn(
        "w-8 h-8 flex items-center justify-center rounded-lg text-muted-foreground",
        "hover:bg-muted hover:text-foreground transition-colors",
      )}
    >
      {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
    </button>
  );
}
