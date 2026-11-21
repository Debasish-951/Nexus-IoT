import { useState, useRef, useEffect } from "react";
import { useLocation, useSearch } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  BrainCircuit, Send, User, Sparkles, Activity, AlertTriangle,
  Lightbulb, MessageSquare, Loader2, Wrench,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/auth-api";
import { useT } from "@/i18n";
import { useProject } from "@/contexts/ProjectContext";
import { AssetScopePicker, useAssetTree } from "@/components/AssetScopePicker";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface Msg {
  role: "user" | "assistant";
  content: string;
  steps?: { tool: string; args: unknown }[];
  error?: boolean;
}

// The four submenu actions all drive the same engine with a seeded prompt.
const QUICK_ACTIONS = [
  {
    key: "ask",
    label: "Ask Your Assets",
    icon: MessageSquare,
    prompt: "", // free-form — just focuses the input
    hint: "Ask anything about your assets, telemetry, or alarms",
  },
  {
    key: "health",
    label: "Health Insights",
    icon: Activity,
    prompt: "Give me a health overview of all assets — which are healthy, which are in alarm, and which are stale. Summarize the fleet.",
    hint: "Fleet-wide health summary",
  },
  {
    key: "failure",
    label: "Failure Explanations",
    icon: AlertTriangle,
    prompt: "Explain the most severe active alarm right now: which asset, what happened, and the likely cause based on its recent telemetry.",
    hint: "Root-cause for the worst current alarm",
  },
  {
    key: "recommend",
    label: "Smart Recommendations",
    icon: Lightbulb,
    prompt: "Which assets need attention this week? Rank them and explain why, using active alarms, recent alarm history, and data freshness.",
    hint: "Heuristic attention ranking",
  },
] as const;

// A datetime-local input takes local wall-clock time ("YYYY-MM-DDTHH:mm"), not ISO.
function toLocalInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const EXAMPLES = [
  "Why is the Fan's health dropping?",
  "Show assets with high vibration",
  "Compare temperature of Fan over the last 24 hours",
  "Which assets are stale right now?",
];

export default function AICopilot() {
  const t = useT();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  // Prefilled so the sidebar shortcuts, which send immediately, always have a range.
  const [rangeFrom, setRangeFrom] = useState(() => toLocalInputValue(new Date(Date.now() - 24 * 3600_000)));
  const [rangeTo, setRangeTo] = useState(() => toLocalInputValue(new Date()));
  const scrollRef = useRef<HTMLDivElement>(null);
  // Which project or asset the questions are about ("all" = everything the user can see).
  // Sent with every question, so it can change mid-conversation.
  const { currentProjectId } = useProject();
  const [scope, setScope] = useState<string>(() => currentProjectId || "all");
  const tree = useAssetTree();
  const scopeName = scope === "all" ? t("All assets") : tree.byId.get(scope)?.name ?? "…";

  const fromDate = new Date(rangeFrom);
  const toDate = new Date(rangeTo);
  const rangeError =
    !rangeFrom || !rangeTo || Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())
      ? "Set both a start and an end time."
      : fromDate >= toDate
        ? "\"From\" must be earlier than \"To\"."
        : null;
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const search = useSearch();
  const lastAction = useRef<string | null>(null);
  const [, navigate] = useLocation();
  // Reports moved to their own page (AI Advisor -> AI Reports); older links such as
  // /ai-copilot?action=report&assetId=...&from=...&to=... are forwarded with their parameters.
  useEffect(() => {
    const p = new URLSearchParams(search);
    if (p.get("action") !== "report") return;
    p.delete("action");
    const rest = p.toString();
    navigate(rest ? `/ai-reports?${rest}` : "/ai-reports", { replace: true });
  }, [search, navigate]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  // Deep-link from the sidebar submenus: /ai-copilot?action=health|failure|recommend
  useEffect(() => {
    const action = new URLSearchParams(search).get("action");
    if (!action || lastAction.current === action) return;
    const qa = QUICK_ACTIONS.find((a) => a.key === action);
    // Marked handled only once send() accepts it. Clicked while an answer was
    // still loading, it used to be marked and then dropped; now it waits, and
    // this effect re-runs when loading ends.
    if (qa?.prompt && send(qa.prompt)) lastAction.current = action;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, loading, rangeError]);

  /** Returns false when the question was not sent (empty, busy, or bad range). */
  function send(question: string): boolean {
    const q = question.trim();
    if (!q || loading || rangeError) return false;
    void sendNow(q);
    return true;
  }

  async function sendNow(q: string) {

    // Error bubbles are not part of the conversation: resending them only spends tokens.
    const history = messages.filter((m) => !m.error).map((m) => ({ role: m.role, content: m.content }));
    const next: Msg[] = [...messages, { role: "user", content: q }];
    setMessages(next);
    setInput("");
    setLoading(true);

    try {
      const res = await apiFetch(`${BASE}/api/ai/chat`, {
        method: "POST",
        body: JSON.stringify({
          question: q,
          history,
          range: { from: fromDate.toISOString(), to: toDate.toISOString() },
          scopeAssetId: scope === "all" ? null : scope,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessages([...next, { role: "assistant", content: data.error ?? "Request failed.", error: true }]);
      } else {
        setMessages([...next, { role: "assistant", content: data.answer ?? "(no answer)", steps: data.steps }]);
      }
    } catch (err: any) {
      setMessages([...next, { role: "assistant", content: err?.message ?? "Network error.", error: true }]);
    } finally {
      setLoading(false);
    }
  }

  function handleQuickAction(prompt: string) {
    if (prompt) send(prompt);
    else inputRef.current?.focus();
  }

  return (
    <div className="flex flex-col h-full p-4 pr-14 pb-12 gap-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-primary/10 text-primary">
          <BrainCircuit className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            AI Advisor
            <Badge variant="secondary" className="text-[10px] gap-1">
              <Sparkles className="w-3 h-3" /> Groq
            </Badge>
          </h1>
          <p className="text-sm text-muted-foreground">Ask anything about your assets, telemetry, and alarms</p>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex flex-col xl:flex-row gap-4">
      {/* What to ask about: scope and time range, in the free space left of the page */}
      <Card className="xl:w-60 shrink-0 p-3 space-y-3 self-start w-full">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t("Ask about")}</p>
        <div className="space-y-1">
          <Label htmlFor="ai-scope" className="text-[11px] text-muted-foreground">{t("Project or asset")}</Label>
          <AssetScopePicker id="ai-scope" value={scope} onChange={setScope} allLabel={t("All assets")} className="h-8 text-xs w-full" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="ai-range-from" className="text-[11px] text-muted-foreground">{t("From")}</Label>
          <Input id="ai-range-from" type="datetime-local" value={rangeFrom} onChange={(e) => setRangeFrom(e.target.value)} disabled={loading} className="h-8 w-full text-xs" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="ai-range-to" className="text-[11px] text-muted-foreground">{t("To")}</Label>
          <Input id="ai-range-to" type="datetime-local" value={rangeTo} onChange={(e) => setRangeTo(e.target.value)} disabled={loading} className="h-8 w-full text-xs" />
        </div>
        {rangeError && <p className="text-[11px] text-destructive">{rangeError}</p>}
      </Card>


      <div className="flex-1 flex flex-col min-h-0 gap-4 min-w-0">
      {/* Quick actions (the 4 submenus) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        {QUICK_ACTIONS.map((a) => (
          <button
            key={a.key}
            onClick={() => handleQuickAction(a.prompt)}
            disabled={loading || (!!a.prompt && !!rangeError)}
            className="text-left p-3 rounded-lg border bg-card hover:bg-accent hover:border-primary/40 transition-colors disabled:opacity-50"
          >
            <div className="flex items-center gap-2 text-sm font-medium">
              <a.icon className="w-4 h-4 text-primary shrink-0" />
              {t(a.label)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">{t(a.hint)}</p>
          </button>
        ))}
      </div>

      {/* Conversation */}
      <Card className="flex-1 flex flex-col min-h-0 min-w-0">
        <div className="border-b px-4 py-2 text-xs text-muted-foreground">
          {t("Asking about: {name}", { name: scopeName })}
          {scope !== "all" && <span className="ml-1">{t("(and the assets beneath it)")}</span>}
        </div>
        <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto">
          <div className="p-4 space-y-4">
            {messages.length === 0 && (
              <div className="text-center py-10">
                <BrainCircuit className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
                <p className="text-sm text-muted-foreground mb-4">
                  Ask a question, or try one of these:
                </p>
                <div className="flex flex-wrap gap-2 justify-center max-w-xl mx-auto">
                  {EXAMPLES.map((ex) => (
                    <button
                      key={ex}
                      onClick={() => send(ex)}
                      disabled={loading || !!rangeError}
                      className="text-xs px-3 py-1.5 rounded-full border bg-card hover:bg-accent transition-colors disabled:opacity-50"
                    >
                      {ex}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m, i) => (
              <div key={i} className={cn("flex gap-3", m.role === "user" && "flex-row-reverse")}>
                <div
                  className={cn(
                    "w-7 h-7 rounded-full flex items-center justify-center shrink-0",
                    m.role === "user" ? "bg-muted" : "bg-primary/10 text-primary",
                  )}
                >
                  {m.role === "user" ? <User className="w-4 h-4" /> : <BrainCircuit className="w-4 h-4" />}
                </div>
                <div className={cn("max-w-[80%] space-y-1.5", m.role === "user" && "items-end flex flex-col")}>
                  <div
                    className={cn(
                      "rounded-lg px-3 py-2 text-sm whitespace-pre-wrap break-words",
                      m.role === "user"
                        ? "bg-primary text-primary-foreground"
                        : m.error
                          ? "bg-red-50 text-red-700 border border-red-200"
                          : "bg-muted",
                    )}
                  >
                    {m.content}
                  </div>
                  {m.steps && m.steps.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {m.steps.map((s, j) => (
                        <span
                          key={j}
                          className="inline-flex items-center gap-1 text-[10px] text-muted-foreground bg-muted/60 rounded px-1.5 py-0.5"
                        >
                          <Wrench className="w-2.5 h-2.5" />
                          {s.tool}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {loading && (
              <div className="flex gap-3">
                <div className="w-7 h-7 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
                  <BrainCircuit className="w-4 h-4" />
                </div>
                <div className="bg-muted rounded-lg px-3 py-2 text-sm text-muted-foreground flex items-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Thinking & gathering data…
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Input */}
        <div className="border-t p-3">
          <div className="flex gap-2 items-end">
            <Textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(input);
                }
              }}
              placeholder="Ask about your assets, telemetry, or alarms…  (Enter to send, Shift+Enter for newline)"
              rows={1}
              className="resize-none min-h-[40px] max-h-32"
              disabled={loading}
            />
            <Button onClick={() => send(input)} disabled={loading || !input.trim() || !!rangeError} size="icon" className="shrink-0">
              <Send className="w-4 h-4" />
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground mt-1.5">
            Answers come from your live platform data. <strong>Smart Recommendations</strong> use a heuristic
            ranking (alarms, history, freshness) — not a machine-learning failure prediction. Read-only: the
            Assistant cannot change anything.
          </p>
        </div>
      </Card>
      </div>
      </div>
    </div>
  );
}
