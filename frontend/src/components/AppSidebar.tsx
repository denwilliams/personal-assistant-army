import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  Bot,
  Sparkles,
  Workflow,
  Clock,
  Bell,
  MessageSquare,
  Settings,
  LogOut,
  ChevronsUpDown,
  Users,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "../contexts/AuthContext";
import { useUnreadNotificationCount } from "../hooks/useUnreadNotificationCount";
import { api } from "../lib/api";

interface Agent {
  id: number;
  slug: string;
  name: string;
  is_favorite: boolean;
}

const NAV_ITEMS = [
  { label: "Dashboard", path: "/", icon: LayoutDashboard },
  { label: "Agents", path: "/agents", icon: Bot },
  { label: "Skills", path: "/skills", icon: Sparkles },
  { label: "Workflows", path: "/workflows", icon: Workflow },
  { label: "Schedules", path: "/schedules", icon: Clock },
  { label: "Team", path: "/team", icon: Users },
];

export function AppSidebar() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const { count: unreadCount } = useUnreadNotificationCount();
  const [favoriteAgents, setFavoriteAgents] = useState<Agent[]>([]);

  useEffect(() => {
    api.agents
      .list()
      .then((agents) => setFavoriteAgents(agents.filter((a) => a.is_favorite)))
      .catch(() => {});
  }, []);

  const isActive = (path: string) => {
    if (path === "/") return location.pathname === "/";
    return location.pathname.startsWith(path);
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link to="/">
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground text-sm font-bold">
                  PA
                </div>
                <div className="flex flex-col gap-0.5 leading-none">
                  <span className="font-semibold">Assistant Army</span>
                  <span className="text-xs text-muted-foreground">AI Platform</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {/* Main Navigation */}
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV_ITEMS.map((item) => (
                <SidebarMenuItem key={item.path}>
                  <SidebarMenuButton asChild isActive={isActive(item.path)} tooltip={item.label}>
                    <Link to={item.path}>
                      <item.icon />
                      <span>{item.label}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
              {/* Notifications with badge */}
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={isActive("/notifications")} tooltip="Notifications">
                  <Link to="/notifications">
                    <Bell />
                    <span>Notifications</span>
                  </Link>
                </SidebarMenuButton>
                {unreadCount > 0 && (
                  <SidebarMenuBadge>{unreadCount > 99 ? "99+" : unreadCount}</SidebarMenuBadge>
                )}
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarSeparator />

        {/* Favorite Agents */}
        {favoriteAgents.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel>Favorites</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {favoriteAgents.map((agent) => (
                  <SidebarMenuItem key={agent.id}>
                    <SidebarMenuButton asChild isActive={location.pathname === `/chat/${agent.slug}`} tooltip={agent.name}>
                      <Link to={`/chat/${agent.slug}`}>
                        <MessageSquare />
                        <span>{agent.name}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton size="lg">
                  {user?.avatar_url ? (
                    <img
                      src={user.avatar_url}
                      alt={user.name}
                      className="size-8 rounded-lg object-cover"
                    />
                  ) : (
                    <div className="flex size-8 items-center justify-center rounded-lg bg-muted text-sm font-medium">
                      {user?.name?.charAt(0)?.toUpperCase() || "?"}
                    </div>
                  )}
                  <div className="flex flex-col gap-0.5 leading-none text-left">
                    <span className="font-medium text-sm truncate">{user?.name}</span>
                    <span className="text-xs text-muted-foreground truncate">{user?.email}</span>
                  </div>
                  <ChevronsUpDown className="ml-auto size-4" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start" className="w-56">
                <DropdownMenuItem asChild>
                  <Link to="/profile" className="flex items-center gap-2 cursor-pointer">
                    <Settings className="size-4" />
                    Profile Settings
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={logout} className="flex items-center gap-2 cursor-pointer">
                  <LogOut className="size-4" />
                  Log out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
