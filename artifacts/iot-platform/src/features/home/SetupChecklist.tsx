import { useLocation } from "wouter";
import { Check, Radio } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Panel, Track, EmptyHint } from "./primitives";

/**
 * What the page shows before any telemetry exists.
 *
 * This is the direct fix for the original complaint. Bands 3 and 4 have nothing
 * to draw on a fresh install, so rather than rendering four empty charts the
 * page collapses to this: a checklist that still has a job when there is
 * nothing to report.
 *
 * The steps are derived from real counts, not stored anywhere — there is no
 * "onboarding state" to get out of sync with the database.
 */

export interface SetupCounts {
  assets: number;
  users: number;
  brokers: number;
  rules: number;
  dashboards: number;
}

export function SetupChecklist({ counts, hasTelemetry }: {
  counts: SetupCounts;
  hasTelemetry: boolean;
}) {
  const [, navigate] = useLocation();

  const steps = [
    { done: counts.assets > 0, title: "Create your asset hierarchy",
      hint: counts.assets > 0 ? `${counts.assets} asset${counts.assets === 1 ? "" : "s"}` : "A plant, a line, and the machines under them",
      cta: "Create", href: "/assets" },
    { done: counts.users > 1, title: "Invite your team",
      hint: counts.users > 1 ? `${counts.users} users` : "Roles decide what each person can see and change",
      cta: "Invite", href: "/users" },
    { done: hasTelemetry || counts.brokers > 0, title: "Connect a data source",
      hint: "MQTT broker, HTTP ingest or Azure IoT Hub",
      cta: "Connect", href: "/integrations" },
    { done: counts.rules > 0, title: "Create your first alarm rule",
      hint: "Threshold or rate-of-change on any metric",
      cta: "Create", href: "/alarm-rules" },
    { done: counts.dashboards > 0, title: "Build a dashboard",
      hint: "Drag widgets onto a canvas in Visualization",
      cta: "Build", href: "/visualization" },
  ];

  const done = steps.filter((s) => s.done).length;

  return (
    <div className="space-y-3.5">
      <Panel title="Setup progress" sub={`${done} of ${steps.length} steps done`}>
        <div className="p-4">
          <Track value={(done / steps.length) * 100} className="h-2" barClassName="bg-teal-500" />
        </div>
      </Panel>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
        <Panel title="Get started" sub={`${steps.length - done} step${steps.length - done === 1 ? "" : "s"} left`}>
          <div>
            {steps.map((step) => (
              <div key={step.title}
                   className="flex items-center gap-3 px-4 py-3 border-b border-border/50 last:border-0">
                <span className={cn("w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-[11px] font-bold",
                  step.done ? "bg-green-500/15 text-green-500" : "bg-muted text-muted-foreground")}>
                  {step.done ? <Check className="w-3.5 h-3.5" /> : steps.indexOf(step) + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <p className={cn("text-[13px] font-medium truncate",
                    step.done && "text-muted-foreground line-through")}>{step.title}</p>
                  <p className="text-[11px] text-muted-foreground truncate">{step.hint}</p>
                </div>
                {!step.done && (
                  <Button size="sm" variant="outline" className="h-6 px-2 text-[11px] shrink-0"
                          onClick={() => navigate(step.href)}>
                    {step.cta}
                  </Button>
                )}
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Waiting for data" sub="The ingest endpoint is live and listening">
          <div className="p-4">
            <EmptyHint
              icon={Radio}
              title="No telemetry received yet"
              hint="Send one payload and the live tiles, charts and health score populate on their own — none of it needs configuring first."
              action={
                <div className="flex gap-2">
                  <Button size="sm" className="h-7 text-[11.5px]"
                          onClick={() => navigate("/integrations")}>Open ingest simulator</Button>
                  <Button size="sm" variant="outline" className="h-7 text-[11.5px]"
                          onClick={() => navigate("/api-clients")}>Get an API key</Button>
                </div>
              }
            />
            <pre className="mt-4 p-3 rounded-lg bg-muted/60 border border-border text-[10.5px]
                            leading-relaxed overflow-x-auto font-mono text-muted-foreground">
{`POST /api/ingest/payload
x-api-key: <your key>

{ "deviceId": "fan-01",
  "metrics": { "bearing_temp": 72.4 } }`}
            </pre>
          </div>
        </Panel>
      </div>
    </div>
  );
}
