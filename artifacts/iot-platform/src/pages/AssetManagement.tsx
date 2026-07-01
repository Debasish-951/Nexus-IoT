import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { Blocks, FileText, Image, ArrowRight, ArrowLeft, Boxes } from "lucide-react";

const CARDS = [
  {
    title: "Asset Templates",
    description: "Create and manage reusable templates. Define attributes and schemas for your assets.",
    href: "/asset-templates",
    icon: FileText,
    tint: "bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-300",
    activeBg: "active:bg-blue-50/70 dark:active:bg-blue-950/30",
    accent: "#3b82f6",
  },
  {
    title: "Assets",
    description: "View, search and manage all assets in your system.",
    href: "/assets",
    icon: Blocks,
    tint: "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-300",
    activeBg: "active:bg-emerald-50/70 dark:active:bg-emerald-950/30",
    accent: "#22c55e",
  },
  {
    title: "Media Library",
    description: "Upload and manage images, videos and documents for your assets.",
    href: "/media-library",
    icon: Image,
    tint: "bg-violet-50 text-violet-600 dark:bg-violet-950/40 dark:text-violet-300",
    activeBg: "active:bg-violet-50/70 dark:active:bg-violet-950/30",
    accent: "#a855f7",
  },
];

export default function AssetManagement() {
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
        <Boxes className="w-6 h-6 text-primary" />
        <h1 className="text-2xl font-bold">Asset Management</h1>
      </div>
      <p className="text-sm text-muted-foreground mb-6">Manage your assets and asset templates</p>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {CARDS.map((c) => (
          <motion.div
            key={c.href}
            whileHover={{ y: -8 }}
            whileTap={{ scale: 0.9 }}
            transition={{ type: "spring", stiffness: 420, damping: 12 }}
          >
            <Card
              onClick={() => navigate(c.href)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate(c.href); } }}
              style={{ borderTopColor: c.accent, borderTopWidth: 4 }}
              className={`cursor-pointer shadow-sm group select-none border min-h-[210px] h-full backdrop-blur-sm
                transition-all duration-150 hover:shadow-xl hover:border-primary/40 ${c.activeBg}
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
