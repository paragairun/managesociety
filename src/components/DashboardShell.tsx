import { ReactNode } from "react";
import { LucideIcon, Power } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ThemeToggle";

export interface NavItem {
  id: string;
  title: string;
  icon: LucideIcon;
}

interface DashboardShellProps {
  brandTitle: string;
  brandSubtitle?: string;
  groupLabel: string;
  items: NavItem[];
  activeId: string;
  onSelect: (id: string) => void;
  onSignOut: () => void;
  headerExtra?: ReactNode;
  children: ReactNode;
}

const SidebarBody = ({
  brandTitle,
  brandSubtitle,
  groupLabel,
  items,
  activeId,
  onSelect,
}: Pick<DashboardShellProps, "brandTitle" | "brandSubtitle" | "groupLabel" | "items" | "activeId" | "onSelect">) => {
  const { state, setOpenMobile, isMobile } = useSidebar();
  const collapsed = state === "collapsed";

  const handleClick = (id: string) => {
    onSelect(id);
    if (isMobile) setOpenMobile(false);
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="px-3 py-3 border-b border-sidebar-border">
        {!collapsed ? (
          <div>
            <p className="text-sm font-bold text-sidebar-foreground truncate">{brandTitle}</p>
            {brandSubtitle && (
              <p className="text-xs text-sidebar-foreground/60 truncate">{brandSubtitle}</p>
            )}
          </div>
        ) : (
          <div className="h-5" />
        )}
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>{groupLabel}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => {
                const Icon = item.icon;
                const active = item.id === activeId;
                return (
                  <SidebarMenuItem key={item.id}>
                    <SidebarMenuButton
                      isActive={active}
                      onClick={() => handleClick(item.id)}
                      tooltip={item.title}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      <span>{item.title}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
};

const DashboardShell = ({
  brandTitle,
  brandSubtitle,
  groupLabel,
  items,
  activeId,
  onSelect,
  onSignOut,
  headerExtra,
  children,
}: DashboardShellProps) => {
  const active = items.find((i) => i.id === activeId);
  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background">
        <SidebarBody
          brandTitle={brandTitle}
          brandSubtitle={brandSubtitle}
          groupLabel={groupLabel}
          items={items}
          activeId={activeId}
          onSelect={onSelect}
        />
        <div className="flex-1 flex flex-col min-w-0">
          <header className="sticky top-0 z-30 h-14 flex items-center gap-2 border-b border-border bg-background/95 backdrop-blur px-3 sm:px-4">
            <SidebarTrigger />
            <div className="flex-1 min-w-0">
              <h1 className="text-base sm:text-lg font-semibold text-foreground truncate">
                {active?.title ?? brandTitle}
              </h1>
            </div>
            {headerExtra}
            <ThemeToggle />
            <Button
              variant="ghost"
              size="icon"
              onClick={onSignOut}
              className="text-muted-foreground hover:text-destructive-ink"
              aria-label="Sign out"
            >
              <Power className="h-5 w-5" />
            </Button>
          </header>
          <main className="flex-1 p-3 sm:p-6 max-w-5xl w-full mx-auto space-y-6">
            {children}
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
};

export default DashboardShell;
