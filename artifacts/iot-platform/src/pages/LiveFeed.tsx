import { FEATURES } from "@/lib/features";
import LiveFeedClassic from "./LiveFeedClassic";
import LiveFeedPage from "@/features/liveFeed/LiveFeedPage";

/**
 * Data Studio > Live Feed. The redesigned page (status strip, "Needs attention
 * now", assets by machine, event stream) is the default; VITE_CLASSIC_LIVE_FEED=true
 * restores the earlier page, kept unchanged in LiveFeedClassic.tsx.
 */
export default function LiveFeed() {
  if (FEATURES.classicLiveFeed) return <LiveFeedClassic />;
  return <LiveFeedPage />;
}
