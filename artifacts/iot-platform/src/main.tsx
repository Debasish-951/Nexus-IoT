import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// Apply saved theme before first paint to avoid a flash of the wrong theme.
try {
  if (localStorage.getItem("theme") === "dark") {
    document.documentElement.classList.add("dark");
  }
} catch {
  /* ignore storage errors */
}

createRoot(document.getElementById("root")!).render(<App />);
