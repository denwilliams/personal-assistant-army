import { useEffect, useState, useCallback, useRef } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  LayoutDashboard,
  Bot,
  Sparkles,
  Clock,
  Bell,
  MessageSquare,
  Settings,
  LogOut,
  ChevronsUpDown,
  Users,
  Wand2,
  Workflow,
  Plus,
  Settings2,
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

interface Conversation {
  id: number;
  title?: string;
  created_at: string;
  updated_at: string;
}

type SidebarView = "main" | "agents" | "agent-detail";

const NAV_ITEMS = [
  { label: "Skills", path: "/skills", icon: Sparkles },
  { label: "Workflows", path: "/workflows", icon: Workflow },
  { label: "Workflow Builder", path: "/workflow-builder", icon: Wand2 },
  { label: "Schedules", path: "/schedules", icon: Clock },
  { label: "Team", path: "/team", icon: Users },
];

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  if (diffSecs < 60) return "Just now";
  const diffMins = Math.floor(diffSecs / 60);
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

export function AppSidebar() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const { count: unreadCount } = useUnreadNotificationCount();

  const [view, setView] = useState<SidebarView>("main");
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [chatHistory, setChatHistory] = useState<Conversation[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const viewRef = useRef(view);
  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  // Fetch all agents on mount
  useEffect(() => {
    api.agents.list().then(setAgents).catch(() => {});
  }, []);

  const loadChatHistory = useCallback(async (slug: string) => {
    setLoadingHistory(true);
    try {
      const history = await api.chat.getHistory(slug);
      setChatHistory(history);
    } catch {
      setChatHistory([]);
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  // Sync sidebar view with URL when navigating to /chat/:slug
  useEffect(() => {
    const chatMatch = location.pathname.match(/^\/chat\/([^/]+)$/);
    if (chatMatch && agents.length > 0) {
      const slug = chatMatch[1];
      const agent = agents.find((a) => a.slug === slug);
      if (agent) {
        setSelectedAgent(agent);
        setView("agent-detail");
        loadChatHistory(slug);
        return;
      }
    }
    // If navigated away from chat while in agent-detail, go back to agents list
    if (!location.pathname.startsWith("/chat/") && viewRef.current === "agent-detail") {
      setView("agents");
      setSelectedAgent(null);
      setChatHistory([]);
    }
  }, [location.pathname, agents, loadChatHistory]);

  const handleAgentsClick = () => {
    setView("agents");
  };

  const handleAgentSelect = (agent: Agent) => {
    setSelectedAgent(agent);
    setView("agent-detail");
    loadChatHistory(agent.slug);
    navigate(`/chat/${agent.slug}`);
  };

  const handleBack = () => {
    if (view === "agent-detail") {
      setSelectedAgent(null);
      setChatHistory([]);
      setView("agents");
    } else {
      setView("main");
    }
  };

  const isActive = (path: string) => {
    if (path === "/") return location.pathname === "/";
    return location.pathname.startsWith(path);
  };

  const favoriteAgents = agents.filter((a) => a.is_favorite);

  return (
    <Sidebar collapsible="icon">
      {/* Header changes based on view */}
      {view === "main" ? (
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
      ) : (
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg" onClick={handleBack} tooltip="Back">
                <ArrowLeft className="size-5" />
                <span className="font-semibold truncate">
                  {view === "agents" ? "Agents" : selectedAgent?.name || "Agent"}
                </span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
      )}

      {/* Content changes based on view */}
      {view === "main" ? (
        <SidebarContent>
          {/* Main Navigation */}
          <SidebarGroup>
            <SidebarGroupLabel>Navigation</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {/* Dashboard */}
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={isActive("/")} tooltip="Dashboard">
                    <Link to="/">
                      <LayoutDashboard />
                      <span>Dashboard</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                {/* Agents - expands sidebar */}
                <SidebarMenuItem>
                  <SidebarMenuButton
                    onClick={handleAgentsClick}
                    isActive={isActive("/agents") || isActive("/chat")}
                    tooltip="Agents"
                  >
                    <Bot />
                    <span>Agents</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                {/* Other nav items */}
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
                      <SidebarMenuButton
                        onClick={() => handleAgentSelect(agent)}
                        isActive={location.pathname === `/chat/${agent.slug}`}
                        tooltip={agent.name}
                      >
                        <MessageSquare />
                        <span>{agent.name}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          )}
        </SidebarContent>
      ) : view === "agents" ? (
        <SidebarContent>
          {/* Manage Agents link */}
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild tooltip="Manage Agents">
                    <Link to="/agents">
                      <Settings2 />
                      <span>Manage Agents</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          <SidebarSeparator />
          {/* All Agents */}
          <SidebarGroup>
            <SidebarGroupLabel>All Agents</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {agents.length === 0 ? (
                  <div className="px-3 py-2 text-sm text-muted-foreground">
                    No agents yet
                  </div>
                ) : (
                  agents.map((agent) => (
                    <SidebarMenuItem key={agent.id}>
                      <SidebarMenuButton
                        onClick={() => handleAgentSelect(agent)}
                        tooltip={agent.name}
                      >
                        <Bot />
                        <span>{agent.name}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))
                )}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      ) : (
        <SidebarContent>
          {/* New Chat */}
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    tooltip="New Chat"
                    isActive={
                      location.pathname === `/chat/${selectedAgent?.slug}` &&
                      !new URLSearchParams(location.search).get("conversation")
                    }
                  >
                    <Link to={`/chat/${selectedAgent?.slug}`}>
                      <Plus />
                      <span>New Chat</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          <SidebarSeparator />
          {/* Chat History */}
          <SidebarGroup>
            <SidebarGroupLabel>History</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {loadingHistory ? (
                  <div className="px-3 py-2 text-sm text-muted-foreground">
                    Loading...
                  </div>
                ) : chatHistory.length === 0 ? (
                  <div className="px-3 py-2 text-sm text-muted-foreground">
                    No conversations yet
                  </div>
                ) : (
                  chatHistory.map((conv) => {
                    const activeConvId = new URLSearchParams(location.search).get("conversation");
                    return (
                      <SidebarMenuItem key={conv.id}>
                        <SidebarMenuButton
                          asChild
                          tooltip={conv.title || `Chat ${conv.id}`}
                          isActive={activeConvId === String(conv.id)}
                        >
                          <Link to={`/chat/${selectedAgent?.slug}?conversation=${conv.id}`}>
                            <MessageSquare />
                            <div className="flex flex-col gap-0.5 leading-tight overflow-hidden">
                              <span className="truncate text-sm">
                                {conv.title || `Chat ${conv.id}`}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {formatRelativeTime(conv.updated_at)}
                              </span>
                            </div>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })
                )}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      )}

      {/* Footer - same for all views */}
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
