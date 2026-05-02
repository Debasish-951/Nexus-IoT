import { useState } from "react";
import { Link, useLocation } from "wouter";
import {
  Home,
  ChevronDown,
  ChevronRight,
  LayoutDashboard,
  FileText,
  List,
  Image,
  BarChart2,
  Blocks,
  Cpu,
  Bell,
  AlarmClock,
  BookOpen,
  Settings2,
  Router,
  Plug,
  Shield,
  Users,
  KeyRound,
  Activity,
  Menu,
  X,
  Wifi,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";

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
    icon: LayoutDashboard,
    children: [
      { label: "Asset", href: "/assets", icon: Blocks },
      { label: "Asset Template", href: "/asset-templates", icon: FileText },
      { label: "Table List", href: "/settings?v=table", icon: List },
      { label: "Media List", href: "/settings?v=media", icon: Image },
    ],
  },
  { label: "Data Explorer", icon: BarChart2, children: [
    { label: "Explorer", href: "/settings?v=explorer", icon: BarChart2 },
  ]},
  {
    label: "Alarm Management",
    icon: Bell,
    children: [
      { label: "Alarm List", href: "/alarms", icon: AlarmClock },
      { label: "Alarm History", href: "/alarm-history", icon: BookOpen },
      { label: "Alarm Rule", href: "/alarm-rules", icon: Settings2 },
    ],
  },
  {
    label: "Broker Management",
    icon: Router,
    children: [
      { label: "Broker", href: "/brokers", icon: Wifi },
      { label: "Integration", href: "/settings?v=integration", icon: Plug },
    ],
  },
  {
    label: "Security",
    icon: Shield,
    children: [
      { label: "User", href: "/users", icon: Users },
      { label: "API Client", href: "/api-clients", icon: KeyRound },
    ],
  },
  { label: "Activity Log", href: "/settings?v=activity", icon: Activity },
];

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
            "flex items-center gap-2.5 px-3 py-2 rounded-md text-sm cursor-pointer transition-colors",
            isActive
              ? "bg-sidebar-accent text-sidebar-primary font-medium"
              : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          )}
        >
          <item.icon className="w-4 h-4 shrink-0" />
          {!collapsed && <span>{item.label}</span>}
        </div>
      </Link>
    );
  }

  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        data-testid={`nav-group-${item.label.toLowerCase().replace(/\s/g, "-")}`}
        className={cn(
          "w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm cursor-pointer transition-colors",
          isActive
            ? "text-sidebar-primary font-medium"
            : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        )}
      >
        <item.icon className="w-4 h-4 shrink-0" />
        {!collapsed && (
          <>
            <span className="flex-1 text-left">{item.label}</span>
            {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          </>
        )}
      </button>
      {open && !collapsed && (
        <div className="ml-5 mt-0.5 border-l border-sidebar-border pl-2 space-y-0.5">
          {item.children.map((child) => {
            const childActive = location === child.href;
            return (
              <Link key={child.href} href={child.href}>
                <div
                  data-testid={`nav-${child.label.toLowerCase().replace(/\s/g, "-")}`}
                  className={cn(
                    "flex items-center gap-2 px-2 py-1.5 rounded text-xs cursor-pointer transition-colors",
                    childActive
                      ? "bg-sidebar-accent text-sidebar-primary font-medium"
                      : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  )}
                >
                  <child.icon className="w-3.5 h-3.5 shrink-0" />
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

export default function Layout({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* Sidebar */}
      <aside
        className={cn(
          "flex flex-col shrink-0 bg-sidebar border-r border-sidebar-border transition-all duration-200",
          collapsed ? "w-12" : "w-56"
        )}
      >
        {/* Logo */}
        <div className="flex items-center gap-2 px-3 py-3 border-b border-sidebar-border">
          <div className="w-6 h-6 rounded bg-sidebar-primary flex items-center justify-center shrink-0">
            <Cpu className="w-3.5 h-3.5 text-white" />
          </div>
          {!collapsed && (
            <span className="text-sidebar-foreground font-semibold text-sm tracking-tight">
              IoT Platform
            </span>
          )}
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="ml-auto text-sidebar-foreground hover:text-sidebar-accent-foreground transition-colors"
            data-testid="sidebar-toggle"
          >
            {collapsed ? <Menu className="w-4 h-4" /> : <X className="w-4 h-4" />}
          </button>
        </div>

        {/* Nav */}
        <ScrollArea className="flex-1 px-2 py-2">
          <div className="space-y-0.5">
            {navItems.map((item) => (
              <NavGroup key={item.label} item={item} collapsed={collapsed} />
            ))}
          </div>
        </ScrollArea>

        {/* Footer */}
        {!collapsed && (
          <div className="px-3 py-2 border-t border-sidebar-border">
            <p className="text-xs text-sidebar-foreground opacity-50">v1.0.0</p>
          </div>
        )}
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  );
}
