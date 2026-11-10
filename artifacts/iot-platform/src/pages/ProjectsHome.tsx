import { Link } from "wouter";
import { motion } from "framer-motion";
import { ArrowRight, Factory } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { useCurrentUser } from "@/contexts/UserContext";
import { useProject } from "@/contexts/ProjectContext";
import { Greeting } from "@/features/home/Greeting";
import { HomeBackground } from "@/features/home/HomeBackground";

const APP_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const SECTIONS = [
  { module: "assets", label: "Assets", path: "assets" },
  { module: "visualization", label: "Visualization", path: "visualization" },
];

const ACCENTS = [
  { color: "#3b82f6", tint: "bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-300" },
  { color: "#22c55e", tint: "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-300" },
  { color: "#a855f7", tint: "bg-violet-50 text-violet-600 dark:bg-violet-950/40 dark:text-violet-300" },
  { color: "#f59e0b", tint: "bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-300" },
];

/** Home: the projects this user may open. The server decides which those are. */
export default function ProjectsHome() {
  const { session, canModule } = useCurrentUser();
  const { projects, loaded, canListProjects } = useProject();
  const sections = SECTIONS.filter((s) => canModule(s.module));

  return (
    <div className="relative min-h-full overflow-hidden">
      <HomeBackground />
      <div className="relative p-8 space-y-6">
        <Greeting subtitle="Your projects" />

        {loaded && projects.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {!canListProjects ? "Your account cannot view the project list."
              : session?.restrictProjects ? "No project assigned. Ask an administrator to assign one."
              : "No projects yet. Create a top-level asset in Assets to start one."}
          </p>
        )}

        <div className="grid gap-4 grid-cols-[repeat(auto-fill,minmax(240px,280px))]">
          {projects.map((p, index) => {
            const accent = ACCENTS[index % ACCENTS.length]!;
            return (
              <motion.div
                key={p.id}
                whileHover={{ y: -8 }}
                transition={{ type: "spring", stiffness: 420, damping: 12 }}
              >
                <Card
                  style={{ borderTopColor: accent.color, borderTopWidth: 3 }}
                  className="group h-full border shadow-sm transition-all duration-150 hover:border-primary/40 hover:shadow-xl"
                >
                  <CardContent className="flex h-full flex-col p-5">
                    <div className={`w-fit rounded-xl p-2.5 transition-transform duration-200 group-hover:scale-110 ${accent.tint}`}>
                      <Factory className="h-5 w-5" />
                    </div>
                    <h2 className="mt-3 truncate text-base font-semibold" title={p.name}>{p.name}</h2>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted-foreground">
                      {sections.map((s) => (
                        <Link
                          key={s.path}
                          href={`~${APP_BASE}/p/${p.id}/${s.path}`}
                          className="group/link inline-flex items-center gap-1 hover:text-primary"
                        >
                          {s.label}
                          <ArrowRight className="h-3.5 w-3.5 transition-transform duration-200 group-hover/link:translate-x-1" />
                        </Link>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
