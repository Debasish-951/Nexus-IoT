import { LayoutGrid, Rows3 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useHomeView, type HomeView } from "./useHomeView";

/**
 * Segmented control that swaps between the banded Overview and the original
 * Dashboard.
 *
 * Deliberately in the page header rather than buried in Settings: the point of
 * keeping both is that switching back is one obvious click, and a preference
 * nobody can find is not a way back.
 */

const OPTIONS: Array<{ value: HomeView; label: string; icon: React.ElementType; title: string }> = [
  { value: "overview", label: "Overview", icon: Rows3,
    title: "Banded overview — health, attention queue, live signals, trends" },
  { value: "classic", label: "Classic", icon: LayoutGrid,
    title: "The original dashboard" },
];

export function ViewSwitch() {
  const [view, setView] = useHomeView();

  return (
    <div className="inline-flex items-center rounded-md border border-border bg-card p-0.5" role="group"
         aria-label="Home page layout">
      {OPTIONS.map((opt) => {
        const active = view === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            title={opt.title}
            aria-pressed={active}
            onClick={() => setView(opt.value)}
            className={cn(
              "inline-flex items-center gap-1.5 h-7 px-2.5 rounded text-[11.5px] font-medium transition-colors",
              active ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <opt.icon className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}
