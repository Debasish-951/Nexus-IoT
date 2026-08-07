import { useState, useMemo } from "react";
import { Link, useLocation } from "wouter";
import {
  ChevronDown, ChevronRight, ChevronsLeft, ChevronsRight, Home, LayoutDashboard,
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
import UserProfileTopMenu from "@/components/UserProfileTopMenu";
import BrokerStatusBar from "@/components/BrokerStatusBar";
import AppearanceMenu from "@/components/AppearanceMenu";
import { FEATURES, type FeatureKey } from "@/lib/features";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface NavChild {
  label: string;
  href: string;
  icon: React.ElementType;
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
}

const navItems: NavItem[] = [
  { label: "Home", href: "/", icon: Home, module: "dashboard" },
  {
    label: "Asset Hub",
    href: "/asset-management",
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
    label: "Data Insights",
    icon: BarChart2,
    children: [
      { label: "Visualization",   href: "/visualization",       icon: LayoutDashboard, module: "visualization" },
      { label: "Live Twin",       href: "/live-twin",           icon: Radio,           module: "visualization" },
      { label: "Asset Template",  href: "/dashboard-templates", icon: LayoutTemplate,  module: "visualization" },
      { label: "Live Feed",       href: "/live",                icon: Activity,        module: "live" },
    ],
  },
  {
    label: "AI Advisor",
    icon: BrainCircuit,
    module: "explorer",
    children: [
      { label: "Ask Your Assets",       href: "/ai-copilot",                   icon: MessageSquare,  module: "explorer" },
      { label: "Health Insights",       href: "/ai-copilot?action=health",     icon: Activity,       module: "explorer" },
      { label: "Failure Explanations",  href: "/ai-copilot?action=failure",    icon: AlertTriangle,  module: "explorer" },
      { label: "Smart Recommendations", href: "/ai-copilot?action=recommend",  icon: Lightbulb,      module: "explorer" },
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
      { label: "Notification Groups", href: "/notification-groups", icon: Users,  module: "alarms" },
    ],
  },
  {
    label: "System",
    icon: Database,
    module: "reports",
    children: [
      { label: "Data Management", href: "/data-management", icon: Database,      module: "reports" },
      { label: "Reports",         href: "/reports",         icon: ClipboardList, module: "reports" },
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
): NavItem[] {
  return items.reduce<NavItem[]>((acc, item) => {
    if (!enabled(item)) return acc;
    if (item.children) {
      const children = item.children.filter((c) => enabled(c) && (!c.module || canModule(c.module)));
      if (children.length > 0) acc.push({ ...item, children });
      return acc;
    }
    if (!item.module || canModule(item.module)) acc.push(item);
    return acc;
  }, []);
}

function NavGroup({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  const [location] = useLocation();
  const [open, setOpen] = useState(() => {
    if (!item.children) return false;
    return item.children.some((c) => location === c.href || location.startsWith(c.href + "/"));
  });

  const isActive = item.href
    ? location === item.href
    : item.children?.some((c) => location === c.href);

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
          {!collapsed && <span>{item.label}</span>}
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
        // small chevron. Asset Hub is the only group in this shape, so it
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
            {!collapsed && <span className="flex-1 text-left truncate">{item.label}</span>}
          </Link>
          {!collapsed && (
            <button onClick={(e) => { e.preventDefault(); setOpen((o) => !o); }} className="shrink-0" aria-label="Toggle section">
              {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            </button>
          )}
        </div>
      ) : (
        <button onClick={() => setOpen((o) => !o)} data-testid={testId} className={cn(headerClasses, "w-full")}>
          <item.icon className="w-[18px] h-[18px] shrink-0" />
          {!collapsed && (
            <>
              <span className="flex-1 text-left">{item.label}</span>
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
                  <span>{child.label}</span>
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
  const [collapsed, setCollapsed] = useState(false);
  const { canModule } = useCurrentUser();

  // Recomputed when the session's grants change (login, admin edit + refresh).
  const nav = useMemo(() => visibleNav(navItems, canModule), [canModule]);

  return (
    <div className="app-shell flex h-screen bg-background overflow-hidden">
      {/* Sidebar */}
      <aside
        className={cn(
          "flex flex-col shrink-0 bg-sidebar border-r border-sidebar-border transition-all duration-200",
          collapsed ? "w-12" : "w-60"
        )}
      >
        {/* Logo + collapse toggle */}
        <div className={cn(
          "flex items-center gap-2 px-3 py-3 border-b border-sidebar-border",
          collapsed && "justify-center px-0"
        )}>
          {!collapsed && (
            <span className="inline-flex items-center bg-white rounded-md px-2 py-1 shadow-sm shrink-0">
              <img src={`${BASE}/web-synergies-logo.png`} alt="Web Synergies"
                className="h-6 w-auto object-contain select-none" draggable={false} />
            </span>
          )}
          <button
            onClick={() => setCollapsed((c) => !c)}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={cn(
              "flex items-center justify-center w-7 h-7 rounded-md border border-sidebar-border text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors",
              !collapsed && "ml-auto"
            )}
            data-testid="sidebar-toggle"
          >
            {collapsed ? <ChevronsRight className="w-4 h-4" /> : <ChevronsLeft className="w-4 h-4" />}
          </button>
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
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="flex items-center justify-center w-8 h-8 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <Menu className="w-4 h-4" />
          </button>
          <div className="flex-1" />
          <BrokerStatusBar />
          <div className="w-px h-5 bg-border" />
          <AppearanceMenu />
          <NotificationBell />
          <div className="w-px h-5 bg-border" />
          <UserProfileTopMenu />
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
