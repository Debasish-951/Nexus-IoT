import Dashboard from "@/pages/Dashboard";
import HomeOverview from "@/pages/HomeOverview";
import { useHomeView } from "@/features/home/useHomeView";

/**
 * The `/` route.
 *
 * Both home pages exist and both stay working: `HomeOverview` is the banded
 * A+B+C layout, `Dashboard` is the original, unchanged apart from a switch
 * added to its header. Neither is deleted, and flipping between them is one
 * click with no reload.
 *
 * Both are imported eagerly rather than lazily. They are the first screen after
 * sign-in, and a `Suspense` flash on the landing page to save a chunk that will
 * be fetched seconds later is a poor trade.
 */
export default function Home() {
  const [view] = useHomeView();
  return view === "classic" ? <Dashboard /> : <HomeOverview />;
}
