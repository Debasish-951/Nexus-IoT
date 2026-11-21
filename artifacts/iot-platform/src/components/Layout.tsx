import { useState, useMemo } from "react";
import { Link, useLocation } from "wouter";
import {
  ChevronDown, ChevronRight, Home, LayoutDashboard,
  FileText, Image, BarChart2, Blocks, Cpu, Bell,
  AlarmClock, BookOpen, Settings2, Router, Plug,
  Shield, Users, KeyRound, Activity, Menu, X,
  Wifi, Zap, Send, Database, PieChart, ClipboardList, BrainCircuit,
  MessageSquare, AlertTriangle, Lightbulb, Radio, LayoutTemplate,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useCurrentUser } from "@/contexts/UserContext";
import NotificationBell from "@/components/NotificationBell";
import CriticalAlarmBanner from "@/components/CriticalAlarmBanner";
import UserProfileTopMenu from "@/components/UserProfileTopMenu";
import BrokerStatusBar from "@/components/BrokerStatusBar";
import AppearanceMenu from "@/components/AppearanceMenu";
import LanguageMenu from "@/components/LanguageMenu";
import { useT } from "@/i18n";
import { FEATURES, type FeatureKey } from "@/lib/features";
import { HomeBackground } from "@/features/home/HomeBackground";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface NavChild {
  label: string;
  href: string;
  icon: React.ElementType;
  /** Hidden for project-restricted users: the server refuses plant-wide data. */
  plantWide?: boolean;
  /** Module key from the Access Control matrix. Omit for always-visible items. */
  module?: string;
  /** Hidden while this feature switch is off. See lib/features.ts. */
  feature?: FeatureKey;
}

interface NavItem {
  label: string;
  href?: string;
  icon: React.ElementType;
  module?: string;
  children?: NavChild[];
  /** Hidden while this feature switch is off. See lib/features.ts. */
  feature?: FeatureKey;
  /**
   * Hidden from project-restricted users: the API refuses these plant-wide
   * endpoints to them (lib/project-access.ts PLATFORM_WIDE), so the entry would
   * only lead to errors.
   */
  plantWide?: boolean;
}

// Former AI Advisor sub-menu, not shown (see the AI Advisor entry below).
const AI_ADVISOR_CHILDREN: NavItem[] = [
  { label: "Ask Your Assets",       href: "/ai-copilot",                   icon: MessageSquare,  module: "ai_advisor" },
  { label: "Health Insights",       href: "/ai-copilot?action=health",     icon: Activity,       module: "ai_advisor" },
  { label: "Failure Explanations",  href: "/ai-copilot?action=failure",    icon: AlertTriangle,  module: "ai_advisor" },
  { label: "Smart Recommendations", href: "/ai-copilot?action=recommend",  icon: Lightbulb,      module: "ai_advisor" },
];
void AI_ADVISOR_CHILDREN;

/**
 * The earlier "System" group (before November 2026). Data Management now sits in
 * Governance with its own module; Reports is behind VITE_CLASSIC_REPORTS. Put this group back
 * into navItems (and remove those two entries) to restore the old menu.
 */
const SYSTEM_GROUP: NavItem = {
  label: "System",
  icon: Database,
  module: "reports",
  children: [
    { label: "Data Management", href: "/data-management", icon: Database,      module: "data_management", plantWide: true },
    { label: "Reports",         href: "/reports",         icon: ClipboardList, module: "reports" },
  ],
};
void SYSTEM_GROUP;

const navItems: NavItem[] = [
  { label: "Home", href: "/", icon: Home, module: "dashboard" },
  {
    // No `href`: the header only toggles, like Data Studio. The /asset-management
    // card page still exists; restoring the href here brings it back.
    label: "Asset Hub",
    icon: LayoutDashboard,
    module: "assets",
    children: [
      { label: "Assets",              href: "/assets",              icon: Blocks,   module: "assets" },
      { label: "Asset Templates",     href: "/asset-templates",     icon: FileText, module: "assets" },
      { label: "Media Library",       href: "/media-library",       icon: Image,    module: "assets" },
      { label: "Hierarchy Generator", href: "/hierarchy-generator", icon: Cpu,      module: "assets", feature: "hierarchyGenerator" },
    ],
  },
  {
    // No `href`: the /data-explorer landing page duplicates what Visualization
    // and Live Feed already show, so the group header only toggles — matching
    // every other pure grouping in this nav. The route still exists and is
    // still reachable directly; it is simply not advertised.
    // Named "Data Insights" until November 2026 (owner renamed it Data Studio).
    label: "Data Studio",
    icon: BarChart2,
    children: [
      { label: "Visualization",   href: "/visualization",       icon: LayoutDashboard, module: "visualization" },
      { label: "Asset Template",  href: "/dashboard-templates", icon: LayoutTemplate,  module: "visualization" },
      { label: "Live Feed",       href: "/live",                icon: Activity,        module: "live" },
      // The classic report builder is replaced by AI Advisor -> AI Reports; it shows
      // here again only when VITE_CLASSIC_REPORTS=true (the /reports route still works).
      { label: "Reports",         href: "/reports",             icon: ClipboardList,   module: "reports", feature: "classicReports" },
    ],
  },
  // Live Twin is its own section (moved out of Data Insights, now Data Studio, at the owner's request).
  { label: "Live Twin", href: "/live-twin", icon: Radio, module: "live_twin" },
  // AI Advisor: the Advisor page (its four modes are cards at the top of that page)
  // and AI Reports, written for the reader's level. Before November 2026 this was a
  // single entry ({ label: "AI Advisor", href: "/ai-copilot", ... }); the older
  // per-mode sub-items are kept in AI_ADVISOR_CHILDREN.
  {
    label: "AI Advisor",
    icon: BrainCircuit,
    module: "ai_advisor",
    plantWide: true,
    children: [
      { label: "Advisor",    href: "/ai-copilot", icon: MessageSquare, module: "ai_advisor", plantWide: true },
      { label: "AI Reports", href: "/ai-reports", icon: FileText,      module: "ai_advisor", plantWide: true },
    ],
  },
  {
    label: "Event Manager",
    icon: Bell,
    module: "alarms",
    children: [
      { label: "Alarm List",    href: "/alarms",        icon: AlarmClock, module: "alarms" },
      { label: "Alarm History", href: "/alarm-history", icon: BookOpen,   module: "alarms" },
      { label: "Alarm Rule",    href: "/alarm-rules",   icon: Settings2,  module: "alarms" },
    ],
  },
  {
    label: "Integration Hub",
    icon: Router,
    module: "brokers",
    children: [
      { label: "Broker",            href: "/brokers",           icon: Wifi,     module: "brokers" },
      // API Client sits with the brokers rather than under Governance: it is an
      // ingest-integration concern (endpoints, scopes, traffic), not an
      // account-security one. Still gated by the `api_clients` module grant.
      { label: "API Client",        href: "/api-clients",       icon: KeyRound, module: "api_clients" },
      { label: "Destinations",      href: "/destinations",      icon: Send,     module: "brokers" },
      // Was "Integration Hub", which now names the group above it — a child
      // repeating its own parent's label reads as a broken menu. "Connections"
      // is what the page actually is: every live inbound and outbound link.
      { label: "Connections",       href: "/integrations",      icon: Plug,     module: "brokers" },
      { label: "Integration Guide", href: "/integration-guide", icon: Zap },
    ],
  },
  {
    label: "Governance",
    icon: Shield,
    children: [
      { label: "User",                href: "/users",               icon: Users,  module: "users" },
      { label: "Security Center",     href: "/security",            icon: Shield, module: "security" },
      { label: "Notification Groups", href: "/notification-groups", icon: Users,  module: "alarms", feature: "notificationChannels" },
      // Moved here from the former System group (November 2026); its own module since then.
      { label: "Data Management",     href: "/data-management",     icon: Database, module: "data_management", plantWide: true },
    ],
  },
  { label: "Audit Log",         href: "/activity-log", icon: Activity, module: "activity_log" },
  { label: "Payload Simulator", href: "/simulator",    icon: Zap,      module: "brokers", feature: "payloadSimulator" },
];

/**
 * Hide nav entries the user cannot open, or that a feature switch has turned off.
 *
 * Module-level visibility control, driven by the same grants the API enforces —
 * a hidden item is not merely cosmetic, the route and the API both refuse it.
 * A group whose children are all hidden disappears entirely rather than
 * expanding into an empty list.
 *
 * Feature switches are checked first because they are absolute: an off feature is
 * hidden from everyone, including an administrator, and its route is not
 * registered either (see ROUTES in App.tsx).
 */
function enabled(item: { feature?: FeatureKey }): boolean {
  return !item.feature || FEATURES[item.feature];
}

function visibleNav(
  items: NavItem[],
  canModule: (key: string, level?: "read" | "write" | "delete") => boolean,
  restrictProjects: boolean,
): NavItem[] {
  return items.reduce<NavItem[]>((acc, item) => {
    if (!enabled(item)) return acc;
    if (item.plantWide && restrictProjects) return acc;
    if (item.children) {
      const children = item.children.filter((c) => enabled(c) && !(c.plantWide && restrictProjects) && (!c.module || canModule(c.module)));
      if (children.length > 0) acc.push({ ...item, children });
      return acc;
    }
    if (!item.module || canModule(item.module)) acc.push(item);
    return acc;
  }, []);
}

function NavGroup({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  const t = useT();
  const [location, navigate] = useLocation();
  // A group without its own page opens an empty main window, so the previous
  // page (often the Home project list) does not stay on screen.
  const sectionHref = `/section/${item.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  const [open, setOpen] = useState(() => {
    if (!item.children) return false;
    // Also open on this group's own empty window: the sidebar is re-created
    // after that navigation, so the submenu must open from the address alone.
    if (location === sectionHref) return true;
    return item.children.some((c) => location === c.href || location.startsWith(c.href + "/"));
  });

  const isActive = item.href
    ? location === item.href
    : location === sectionHref || item.children?.some((c) => location === c.href);

  if (!item.children) {
    return (
      <Link href={item.href ?? "/"}>
        <div
          data-testid={`nav-${item.label.toLowerCase().replace(/\s/g, "-")}`}
          className={cn(
            "flex items-center gap-2.5 px-3 py-2.5 rounded-md text-[15px] cursor-pointer transition-colors",
            isActive
              ? "bg-sidebar-accent text-sidebar-primary font-medium"
              : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          )}
        >
          <item.icon className="w-[18px] h-[18px] shrink-0" />
          {!collapsed && <span>{t(item.label)}</span>}
        </div>
      </Link>
    );
  }

  const headerClasses = cn(
    "flex items-center gap-2.5 px-3 py-2.5 rounded-md text-[15px] cursor-pointer transition-colors",
    isActive
      ? item.href ? "bg-sidebar-accent text-sidebar-primary font-medium" : "text-sidebar-primary font-medium"
      : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
  );
  const testId = `nav-group-${item.label.toLowerCase().replace(/\s/g, "-")}`;

  return (
    <div>
      {item.href ? (
        // Group with a landing page: the label navigates AND expands.
        //
        // It used to only navigate, with the children reachable solely via the
        // small chevron. Asset Hub was the only group in this shape, so it
        // was the only one that appeared to "lag": the click kicked off a route
        // change and page fetch while the submenu stayed shut, which reads as
        // slowness rather than as "that click did something else". Expanding on
        // mousedown makes the children appear immediately, before navigation
        // has even started.
        <div className={cn(headerClasses, "w-full")}>
          <Link
            href={item.href}
            className="flex items-center gap-2.5 flex-1 min-w-0"
            data-testid={testId}
            onMouseDown={() => setOpen(true)}
          >
            <item.icon className="w-[18px] h-[18px] shrink-0" />
            {!collapsed && <span className="flex-1 text-left truncate">{t(item.label)}</span>}
          </Link>
          {!collapsed && (
            <button onClick={(e) => { e.preventDefault(); setOpen((o) => !o); }} className="shrink-0" aria-label="Toggle section">
              {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            </button>
          )}
        </div>
      ) : (
        <button
          onClick={() => {
            // Leaving another page: open the submenu and show the empty window.
            // Already on this group's empty window: toggle the submenu only.
            if (location !== sectionHref) { setOpen(true); navigate(sectionHref); }
            else setOpen((o) => !o);
          }}
          data-testid={testId}
          className={cn(headerClasses, "w-full")}
        >
          <item.icon className="w-[18px] h-[18px] shrink-0" />
          {!collapsed && (
            <>
              <span className="flex-1 text-left">{t(item.label)}</span>
              {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            </>
          )}
        </button>
      )}
      {open && !collapsed && (
        <div className="ml-5 mt-0.5 border-l border-sidebar-border pl-2 space-y-0.5">
          {item.children.map((child) => {
            const childActive = location === child.href;
            return (
              <Link key={child.href} href={child.href}>
                <div
                  data-testid={`nav-${child.label.toLowerCase().replace(/\s/g, "-")}`}
                  className={cn(
                    "flex items-center gap-2 px-2 py-1.5 rounded text-sm cursor-pointer transition-colors",
                    childActive
                      ? "bg-sidebar-accent text-sidebar-primary font-medium"
                      : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  )}
                >
                  <child.icon className="w-4 h-4 shrink-0" />
                  <span>{t(child.label)}</span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

// The sidebar user chip was removed: identity already lives in the top-right
// profile menu, and repeating it here duplicated the name and put the account's
// role on permanent display. Role is not shown to the user anywhere — access is
// assigned by an administrator, not something the user needs to reason about.

export default function Layout({ children }: { children: React.ReactNode }) {
  const t = useT();
  const [collapsed, setCollapsed] = useState(false);
  const { canModule, session } = useCurrentUser();
  const restrictProjects = !!session?.restrictProjects;

  // Recomputed when the session's grants change (login, admin edit + refresh).
  const nav = useMemo(() => visibleNav(navItems, canModule, restrictProjects), [canModule, restrictProjects]);

  return (
    <div className="app-shell flex h-screen bg-background overflow-hidden">
      {/* Sidebar */}
      <aside
        className={cn(
          "flex flex-col shrink-0 bg-sidebar border-r border-sidebar-border transition-all duration-200",
          collapsed ? "w-12" : "w-60 sidebar-iot"
        )}
      >
        {/* Logo */}
        <div className={cn(
          "flex items-center gap-2 px-3 py-3 border-b border-sidebar-border",
          collapsed && "justify-center px-0"
        )}>
          {collapsed ? (
            <span className="relative block w-10 h-[18px] bg-white rounded shadow-sm overflow-hidden">
              <img src={`${BASE}/web-synergies-logo-sidebar.png`} alt="Web Synergies"
                className="absolute top-0 left-0 w-10 max-w-none select-none" draggable={false} />
            </span>
          ) : (
            <>
              <span className="inline-flex items-center bg-white rounded-md p-1 shadow-sm shrink-0">
                <img src={`${BASE}/web-synergies-logo-sidebar.png`} alt="Web Synergies"
                  className="h-9 w-auto object-contain select-none" draggable={false} />
              </span>
              <span className="text-sm font-semibold leading-tight text-sidebar-accent-foreground">Integrated Suite</span>
            </>
          )}
        </div>

        {/* Nav */}
        <ScrollArea type="always" className="sidebar-scroll flex-1 px-2 py-2">
          <div className="space-y-0.5">
            {nav.map((item) => (
              <NavGroup key={item.label} item={item} collapsed={collapsed} />
            ))}
          </div>
        </ScrollArea>

        {/* Compact user chip */}
      </aside>

      {/* Main content column */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <header className="h-12 shrink-0 border-b border-border bg-background/95 backdrop-blur-sm flex items-center px-4 gap-2 relative z-20">
          <button
            onClick={() => setCollapsed((c) => !c)}
            title={collapsed ? t("Expand sidebar") : t("Collapse sidebar")}
            aria-label={collapsed ? t("Expand sidebar") : t("Collapse sidebar")}
            className="flex items-center justify-center w-8 h-8 rounded-md border !border-primary/40 text-primary hover:bg-muted hover:text-foreground transition-colors"
          >
            <Menu className="w-4 h-4" />
          </button>
          <div className="flex-1" />
          <BrokerStatusBar />
          <div className="w-px h-5 bg-border" />
          <LanguageMenu />
          <AppearanceMenu />
          <NotificationBell />
          <div className="w-px h-5 bg-border" />
          <UserProfileTopMenu />
        </header>

        <CriticalAlarmBanner />

        {/* Page content */}
        {/* The background sits in a non-scrolling wrapper so it fills the window
            on long pages instead of scrolling away with the content. */}
        <div className="relative flex-1 min-h-0 overflow-hidden">
          {FEATURES.appBackground && <HomeBackground />}
          <main className="relative h-full overflow-auto">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
