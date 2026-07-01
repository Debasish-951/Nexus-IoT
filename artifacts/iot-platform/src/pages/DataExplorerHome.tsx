import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { Activity, PieChart, ArrowRight, ArrowLeft, BarChart2 } from "lucide-react";

const CARDS = [
  {
    title: "Live Feed",
    description: "Real-time operations center — live sensor data, asset status, health ranking and event timeline.",
    href: "/live",
    icon: Activity,
    tint: "bg-cyan-50 text-cyan-600 dark:bg-cyan-950/40 dark:text-cyan-300",
    activeBg: "active:bg-cyan-50/70 dark:active:bg-cyan-950/30",
    accent: "#06b6d4",
  },
  {
    title: "Visualization",
    description: "Build dashboards and charts from your telemetry to explore trends across assets.",
    href: "/visualization",
    icon: PieChart,
    tint: "bg-violet-50 text-violet-600 dark:bg-violet-950/40 dark:text-violet-300",
    activeBg: "active:bg-violet-50/70 dark:active:bg-violet-950/30",
    accent: "#a855f7",
  },
];

export default function DataExplorerHome() {
  const [, navigate] = useLocation();
  return (
    <div
      className="min-h-full"
      style={{
        backgroundImage:
          "radial-gradient(circle at 1px 1px, rgba(100,116,139,0.12) 1px, transparent 0), linear-gradient(to bottom, rgba(59,130,246,0.06), transparent 260px)",
        backgroundSize: "24px 24px, 100% 100%",
      }}
    >
      <div className="p-6 max-w-5xl mx-auto">
        <button onClick={() => (window.history.length > 1 ? window.history.back() : navigate("/"))} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-3">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <div className="flex items-center gap-2 mb-1">
          <BarChart2 className="w-6 h-6 text-primary" />
          <h1 className="text-2xl font-bold">Data Explorer</h1>
        </div>
        <p className="text-sm text-muted-foreground mb-6">Explore live data and build visualizations</p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {CARDS.map((c) => (
            <motion.div key={c.href} whileHover={{ y: -8 }} whileTap={{ scale: 0.9 }}
              transition={{ type: "spring", stiffness: 420, damping: 12 }}>
              <Card
                onClick={() => navigate(c.href)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate(c.href); } }}
                style={{ borderTopColor: c.accent, borderTopWidth: 4 }}
                className={`cursor-pointer shadow-sm group select-none border min-h-[210px] h-full
                  transition-shadow duration-200 hover:shadow-xl hover:border-primary/40 ${c.activeBg}
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40`}
              >
                <CardContent className="p-8 flex flex-col h-full">
                  <div className="flex items-center justify-between">
                    <div className={`p-4 rounded-2xl transition-transform duration-200 group-hover:scale-110 ${c.tint}`}>
                      <c.icon className="w-7 h-7" />
                    </div>
                    <ArrowRight className="w-6 h-6 text-muted-foreground group-hover:text-primary group-hover:translate-x-1 transition-all duration-200" />
                  </div>
                  <h2 className="text-xl font-semibold mt-5">{c.title}</h2>
                  <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">{c.description}</p>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}
