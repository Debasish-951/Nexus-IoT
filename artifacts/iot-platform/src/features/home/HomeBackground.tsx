import { NodeMesh } from "@/components/NodeMesh";

const GRID_FADE = "radial-gradient(80% 80% at 40% 40%, #000, transparent 85%)";

function grid(rgb: string): React.CSSProperties {
  return {
    backgroundImage: `linear-gradient(rgba(${rgb}) 1px, transparent 1px), linear-gradient(90deg, rgba(${rgb}) 1px, transparent 1px)`,
    backgroundSize: "44px 44px",
    maskImage: GRID_FADE,
    WebkitMaskImage: GRID_FADE,
  };
}

/** The sign-in page's backdrop for Home, with a calmer multi-colour mesh. Shows no data. */
export function HomeBackground() {
  return (
    <div aria-hidden="true" className="absolute inset-0 pointer-events-none">
      <div className="absolute inset-0 dark:hidden"
           style={{ background: "radial-gradient(90% 90% at 20% 8%, rgba(139,123,255,0.10), transparent 60%), #f6f8fb" }} />
      <div className="absolute inset-0 hidden dark:block"
           style={{ background: "radial-gradient(90% 90% at 20% 8%, rgba(139,123,255,0.20), transparent 60%), #060914" }} />
      <NodeMesh variant="home" />
      <div className="absolute inset-0 dark:hidden" style={grid("60,90,160,0.06")} />
      <div className="absolute inset-0 hidden dark:block" style={grid("120,180,255,0.05")} />
    </div>
  );
}
