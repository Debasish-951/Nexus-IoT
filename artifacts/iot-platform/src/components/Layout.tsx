import { useState } from "react";
import { Link, useLocation } from "wouter";
import {
  ChevronDown, ChevronRight, ChevronsLeft, ChevronsRight, Home, LayoutDashboard,
  FileText, Image, BarChart2, Blocks, Cpu, Bell,
  AlarmClock, BookOpen, Settings2, Router, Plug,
  Shield, Users, KeyRound, Activity, Menu, X,
  Wifi, Zap, Send, Database, PieChart, ClipboardList, BrainCircuit,
  MessageSquare, AlertTriangle, Lightbulb,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useCurrentUser } from "@/contexts/UserContext";
import NotificationBell from "@/components/NotificationBell";
import UserProfileTopMenu from "@/components/UserProfileTopMenu";
import BrokerStatusBar from "@/components/BrokerStatusBar";
import ThemeToggle from "@/components/ThemeToggle";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface NavItem {
  label: string;
  href?: string;
  icon: React.ElementType;
  children?: { label: string; href: string; icon: React.ElementType }[];
}

const navItems: NavItem[] = [
  { label: "Home", href: "/", icon: Home },
  {
    label: "Asset Management",
    href: "/asset-management",
    icon: LayoutDashboard,
    children: [
      { label: "Asset Templates",     href: "/asset-templates",     icon: FileText },
      { label: "Assets",              href: "/assets",              icon: Blocks },
      { label: "Media Library",       href: "/media-library",       icon: Image },
      { label: "Hierarchy Generator", href: "/hierarchy-generator", icon: Cpu },
    ],
  },
  { label: "Data Explorer", href: "/data-explorer", icon: BarChart2 },
  {
    label: "AI Assistant",
    icon: BrainCircuit,
    children: [
      { label: "Ask Your Assets",       href: "/ai-copilot",                   icon: MessageSquare },
      { label: "Health Insights",       href: "/ai-copilot?action=health",     icon: Activity },
      { label: "Failure Explanations",  href: "/ai-copilot?action=failure",    icon: AlertTriangle },
      { label: "Smart Recommendations", href: "/ai-copilot?action=recommend",  icon: Lightbulb },
    ],
  },
  {
    label: "Alarm Management",
    icon: Bell,
    children: [
      { label: "Alarm List",    href: "/alarms",        icon: AlarmClock },
      { label: "Alarm History", href: "/alarm-history", icon: BookOpen },
      { label: "Alarm Rule",    href: "/alarm-rules",   icon: Settings2 },
    ],
  },
  {
    label: "Broker Management",
    icon: Router,
    children: [
      { label: "Broker",       href: "/brokers",               icon: Wifi },
      { label: "Destinations",      href: "/destinations",      icon: Send },
      { label: "Integration Hub",   href: "/integrations",      icon: Plug },
      { label: "Integration Guide", href: "/integration-guide", icon: Zap },
    ],
  },
  {
    label: "Security",
    icon: Shield,
    children: [
      { label: "User",                 href: "/users",                icon: Users },
      { label: "API Client",           href: "/api-clients",          icon: KeyRound },
      { label: "Notification Groups",  href: "/notification-groups",  icon: Users },
    ],
  },
  {
    label: "System",
    icon: Database,
    children: [
      { label: "Data Management", href: "/data-management", icon: Database },
      { label: "Reports",         href: "/reports",         icon: ClipboardList },
    ],
  },
  { label: "Activity Log",      href: "/activity-log", icon: Activity },
  { label: "Payload Simulator", href: "/simulator",    icon: Zap },
];

const ROLE_COLORS: Record<string, string> = {
  admin:    "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  engineer: "bg-blue-100  text-blue-700  dark:bg-blue-900/40  dark:text-blue-300",
  operator: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  viewer:   "bg-slate-100 text-slate-600 dark:bg-slate-800    dark:text-slate-300",
};

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
        // Group with a landing page: label navigates, chevron toggles the children.
        <div className={cn(headerClasses, "w-full")}>
          <Link href={item.href} className="flex items-center gap-2.5 flex-1 min-w-0" data-testid={testId}>
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

function SidebarUserChip({ collapsed }: { collapsed: boolean }) {
  const { currentUser } = useCurrentUser();
  if (!currentUser) return null;

  const displayName = currentUser.fullName ?? currentUser.email ?? "User";
  const initials = displayName
    .split(" ").map((w: string) => w[0] ?? "").join("").toUpperCase().slice(0, 2) || "U";

  return (
    <div className={cn(
      "border-t border-sidebar-border px-3 py-2.5 flex items-center gap-2.5",
      collapsed && "justify-center px-0"
    )}>
      <div className="w-7 h-7 rounded-full bg-sidebar-primary flex items-center justify-center shrink-0 text-white text-xs font-bold">
        {initials}
      </div>
      {!collapsed && (
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-sidebar-foreground truncate">{displayName}</p>
          <span className={cn(
            "inline-block text-[10px] px-1.5 py-px rounded-full font-medium capitalize mt-0.5",
            ROLE_COLORS[currentUser.role]
          )}>
            {currentUser.role}
          </span>
        </div>
      )}
    </div>
  );
}

export default function Layout({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="flex h-screen bg-background overflow-hidden">
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
            {navItems.map((item) => (
              <NavGroup key={item.label} item={item} collapsed={collapsed} />
            ))}
          </div>
        </ScrollArea>

        {/* Compact user chip */}
        <SidebarUserChip collapsed={collapsed} />
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
          <ThemeToggle />
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
