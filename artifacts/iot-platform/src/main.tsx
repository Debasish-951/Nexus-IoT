import { createRoot } from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { applyAppearance, readSkin, readTheme } from "./lib/appearance";
import "./index.css";
// Loaded after index.css so the skin's overrides land last. Deleting this one
// line removes the Slate skin entirely and returns the app to Electric Blue.
import "./styles/slate.css";
import "./styles/palettes.css";
import "./styles/sidebar-iot.css";
import "./styles/greeting.css";

// Apply the saved skin and theme before first paint, to avoid a flash of the
// wrong appearance. Both are plain attributes on <html>, so this runs without
// React and without waiting on anything.
applyAppearance(readSkin(), readTheme());

createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
