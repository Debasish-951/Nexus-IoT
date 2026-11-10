import { useEffect, useRef } from "react";

const MIXED_DARK = ["#22d3ee", "#a78bfa", "#34d399", "#fbbf24", "#f472b6", "#60a5fa"];
const MIXED_LIGHT = ["#0891b2", "#7c3aed", "#059669", "#d97706", "#db2777", "#2563eb"];

function rgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${alpha})`;
}

/**
 * Animated sensor mesh on a canvas. Respects prefers-reduced-motion.
 *
 * `login` is the cyan and purple mesh on the dark sign-in page. `home` is a calmer
 * multi-colour mesh that follows the app's light or dark theme.
 */
export function NodeMesh({ variant = "login" }: { variant?: "login" | "home" }) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const ctx = cv.getContext("2d");
    if (!ctx) return;

    let w = 0, h = 0, dpr = 1;
    type P = { x: number; y: number; vx: number; vy: number; tone: number };
    let nodes: P[] = [];
    let raf = 0;

    const seed = () => {
      const rect = cv.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = rect.width; h = rect.height;
      cv.width = Math.max(1, w * dpr);
      cv.height = Math.max(1, h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.max(16, Math.min(46, Math.round((w * h) / 9000)));
      nodes = Array.from({ length: count }, (_, tone) => ({
        x: Math.random() * w, y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.14, vy: (Math.random() - 0.5) * 0.14, tone,
      }));
    };

    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      const home = variant === "home";
      // Read each frame, so switching theme applies without a reload.
      const dark = document.documentElement.classList.contains("dark");
      const palette = dark ? MIXED_DARK : MIXED_LIGHT;
      const toneOf = (p: P) => palette[p.tone % palette.length]!;
      const linkDist = w * 0.16;
      for (const p of nodes) {
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0 || p.x > w) p.vx *= -1;
        if (p.y < 0 || p.y > h) p.vy *= -1;
      }
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i]!, b = nodes[j]!;
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          if (d >= linkDist) continue;
          const strength = 1 - d / linkDist;
          if (home) {
            const alpha = (dark ? 0.35 : 0.3) * strength;
            const gradient = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
            gradient.addColorStop(0, rgba(toneOf(a), alpha));
            gradient.addColorStop(1, rgba(toneOf(b), alpha));
            ctx.strokeStyle = gradient;
          } else {
            ctx.strokeStyle = `rgba(139,123,255,${0.5 * strength})`;
          }
          ctx.lineWidth = home ? 0.8 : 0.7;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
      for (const p of nodes) {
        ctx.beginPath();
        ctx.fillStyle = home ? rgba(toneOf(p), dark ? 0.85 : 0.55) : "rgba(127,227,255,0.9)";
        ctx.arc(p.x, p.y, home ? 2 : 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
      if (!reduce) raf = requestAnimationFrame(draw);
    };

    seed();
    draw();
    // Observes the element, because collapsing the sidebar resizes it without a window resize.
    const observer = new ResizeObserver(() => {
      const rect = cv.getBoundingClientRect();
      if (rect.width === w && rect.height === h) return;
      seed();
      if (reduce) draw();
    });
    observer.observe(cv);
    return () => { cancelAnimationFrame(raf); observer.disconnect(); };
  }, [variant]);

  return <canvas ref={ref} className="absolute inset-0 h-full w-full" aria-hidden />;
}
