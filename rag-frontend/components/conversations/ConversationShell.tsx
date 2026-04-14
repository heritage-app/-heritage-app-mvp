"use client";

import { ChatWindow } from "@/components/chat/ChatWindow";
import { ConversationList } from "@/components/conversations/ConversationList";
import { Button } from "@/components/ui/button";
import { 
  Plus, Menu, X, PanelLeftClose, PanelLeftOpen, 
  Search, Shield, Bot
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useConversationStore } from "@/store/conversationStore";
import { useChatStore } from "@/store/chatStore";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { UserMenu } from "@/components/auth/UserMenu";
import { AuthModal } from "@/components/auth/AuthModal";
import { useUserStore } from "@/store/userStore";
import { apiClient } from "@/lib/api/client";

interface ConversationShellProps {
  conversationId?: string;
  children?: React.ReactNode;
}

const ADMIN_IDS = (process.env.NEXT_PUBLIC_ADMIN_IDS || "").split(",").map(id => id.trim());

export function ConversationShell({ conversationId, children }: ConversationShellProps) {
  const router = useRouter();
  const { selectConversation } = useConversationStore();
  const { clearChat } = useChatStore();

  const [hasMounted, setHasMounted] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => {
    setHasMounted(true);
    if (typeof window !== "undefined") {
      const savedOpen = localStorage.getItem("sidebarOpen");
      if (savedOpen !== null) {
        setSidebarOpen(savedOpen === "true");
      } else {
        setSidebarOpen(window.innerWidth >= 1024);
      }

      const savedCollapsed = localStorage.getItem("sidebarCollapsed");
      if (savedCollapsed !== null) {
        setSidebarCollapsed(savedCollapsed === "true");
      }
    }
  }, []);

  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const checkDesktop = () => {
      setIsDesktop(window.innerWidth >= 1024);
    };
    checkDesktop();
    window.addEventListener("resize", checkDesktop);
    return () => window.removeEventListener("resize", checkDesktop);
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("sidebarOpen", String(sidebarOpen));
      localStorage.setItem("sidebarCollapsed", String(sidebarCollapsed));
    }
  }, [sidebarOpen, sidebarCollapsed]);

  useEffect(() => {
    if (conversationId && conversationId !== "new") {
      selectConversation(conversationId);
    } else {
      clearChat();
      selectConversation("");
    }
  }, [conversationId, selectConversation, clearChat]);

  const handleNewConversation = () => {
    clearChat();
    selectConversation("");
    router.push("/conversations/new");
  };

  const toggleSidebar = () => {
    if (typeof window !== "undefined" && window.innerWidth < 1024) {
      setSidebarOpen((prev) => !prev);
    } else {
      setSidebarCollapsed((prev) => !prev);
    }
  };

  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [role, setRole] = useState<string | null>(null);

  const { setProfile, clearProfile } = useUserStore();

  useEffect(() => {
    const checkUser = async () => {
      try {
        const response = await apiClient.get('/auth/me');
        const userData = response.data;
        setUser(userData);
        setRole(userData.role);
        setProfile(userData);
      } catch (error) {
        setUser(null);
        setRole(null);
        clearProfile();
      }
    };
    
    checkUser();
  }, [setProfile, clearProfile]);
  
  const isAdminOrMod = role === 'admin' || role === 'moderator';

  const [isAdminAuth, setIsAdminAuth] = useState(false);

  const handleAdminPanelClick = () => {
    if (isAdminOrMod) {
      router.push("/admin");
    } else {
      setIsAdminAuth(true);
      setIsAuthModalOpen(true);
    }
  };

  const handleCloseAuth = () => {
    setIsAuthModalOpen(false);
    setIsAdminAuth(false);
  };

  return (
    <div className="flex h-screen overflow-hidden bg-[#141414]">
      {/* Auth Modal */}
      <AuthModal 
        isOpen={isAuthModalOpen} 
        onClose={handleCloseAuth}
        adminOnly={isAdminAuth}
      />
      {hasMounted && sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 transition-opacity duration-300 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <div
        className={cn(
          "fixed lg:relative left-0 top-0 bottom-0 shrink-0 bg-[#0d0d0d] border-r border-white/5 flex flex-col z-40 transition-all duration-300 ease-in-out shadow-lg lg:shadow-none",
          sidebarCollapsed ? "w-16" : "w-64",
          hasMounted && sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        )}
      >
        <div className="p-3 mb-2 flex items-center justify-between">
          {!sidebarCollapsed && (
            <div className="flex items-center gap-2 px-1">
              <Bot className="h-6 w-6 text-white" />
              <div className="flex flex-col text-white">
                <span className="text-[13px] font-bold leading-tight">Heritage App</span>
                <span className="text-[10px] text-white/40 font-medium">Linguistic Engine</span>
              </div>
            </div>
          )}
          <Button
            onClick={toggleSidebar}
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-white/60 hover:text-white hover:bg-white/5"
          >
            {sidebarCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </Button>
        </div>

        <div className="px-2 space-y-0.5">
          <Button 
            onClick={handleNewConversation} 
            variant="ghost"
            className={cn(
              "w-full justify-start text-[13px] font-medium h-10 px-3 hover:bg-white/5 rounded-xl text-white",
              sidebarCollapsed && "justify-center px-0"
            )}
          >
            <Plus className="h-4 w-4 shrink-0" />
            {!sidebarCollapsed && <span className="ml-3">New chat</span>}
          </Button>
          <Button 
            variant="ghost"
            className={cn(
              "w-full justify-start text-[13px] font-medium h-10 px-3 hover:bg-white/5 rounded-xl text-white/60",
              sidebarCollapsed && "justify-center px-0"
            )}
          >
            <Search className="h-4 w-4 shrink-0" />
            {!sidebarCollapsed && <span className="ml-3">Search chats</span>}
          </Button>
          
          {/* Only show Admin Panel if logged out (as a gateway) or if logged in as Admin */}
          {(!user || isAdminOrMod) && (
            <Button 
              onClick={handleAdminPanelClick}
              variant="ghost"
              className={cn(
                "w-full justify-start text-[13px] font-medium h-10 px-3 hover:bg-white/5 rounded-xl text-primary/60 hover:text-primary transition-all",
                sidebarCollapsed && "justify-center px-0"
              )}
            >
              <Shield className="h-4 w-4 shrink-0" />
              {!sidebarCollapsed && <span className="ml-3 font-bold uppercase tracking-wider text-[10px]">Admin Panel</span>}
            </Button>
          )}
        </div>

        <div className="mt-2 flex flex-col flex-1 min-h-0">
          {!sidebarCollapsed && (
            <div className="px-4 mb-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-white/20">Recents</span>
            </div>
          )}
          <div className="flex-1 overflow-y-auto scrollbar-hide">
            <ConversationList 
              onConversationSelect={() => window.innerWidth < 1024 && setSidebarOpen(false)} 
              collapsed={sidebarCollapsed} 
            />
          </div>
        </div>

        <div className="p-2 border-t border-white/5">
          <UserMenu collapsed={sidebarCollapsed} user={user} />
        </div>
      </div>

      <div className="flex-1 min-w-0 flex flex-col w-full bg-[#141414] relative h-full">
        {/* Mobile/Compact Header */}
        <div className="sticky top-0 z-20 border-b border-white/5 bg-[#141414]/95 backdrop-blur-sm px-4 py-3 shrink-0 flex items-center gap-3 sm:px-6">
          <Button
            onClick={toggleSidebar}
            variant="ghost"
            size="icon"
            className="h-9 w-9 shrink-0 rounded-lg hover:bg-white/5 transition-all active:scale-95 lg:hidden"
          >
            <Menu className="h-5 w-5 text-white" />
          </Button>
          
          {/* Desktop Toggle (only visible on desktop) */}
          <Button
            onClick={toggleSidebar}
            variant="ghost"
            size="icon"
            className="hidden lg:flex h-9 w-9 shrink-0 rounded-lg hover:bg-white/5 transition-all active:scale-95"
          >
            {sidebarCollapsed ? <PanelLeftOpen className="h-5 w-5 text-white" /> : <PanelLeftClose className="h-5 w-5 text-white" />}
          </Button>

          <div className="flex flex-col min-w-0">
            <span className="text-[9px] sm:text-[10px] font-bold uppercase tracking-[0.3em] sm:tracking-[0.4em] text-primary truncate">Linguistic Heritage</span>
            <h1 className="text-sm sm:text-lg font-black text-white truncate">Ga Language Engine</h1>
          </div>
        </div>

        {/* Main Content Area */}
        <div className="flex-1 overflow-hidden relative">
          {children}
        </div>
      </div>
    </div>
  );
}
