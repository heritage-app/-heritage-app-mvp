"use client";

import { ConversationList } from "@/components/conversations/ConversationList";
import { ChatWindow } from "@/components/chat/ChatWindow";
import { Button } from "@/components/ui/button";
import { Plus, Menu, X, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useRouter } from "next/navigation";
import { useConversationStore } from "@/store/conversationStore";
import { useChatStore } from "@/store/chatStore";
import { useState, useEffect } from "react";

export default function ConversationsPage() {
  const router = useRouter();
  const { selectedConversationId, selectConversation } = useConversationStore();
  const { clearChat } = useChatStore();
  
  // Initialize sidebar state from localStorage
  // On desktop (lg+): default to true (expanded), can collapse
  // On mobile: default to false (closed), overlay behavior
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("sidebarOpen");
      if (saved !== null) return saved === "true";
      // Default: open on desktop, closed on mobile
      return window.innerWidth >= 1024;
    }
    return true; // Default to open for SSR
  });

  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("sidebarCollapsed");
      return saved === "true";
    }
    return false;
  });

  const [isDesktop, setIsDesktop] = useState(false);

  // Check if desktop on mount and resize
  useEffect(() => {
    const checkDesktop = () => {
      setIsDesktop(window.innerWidth >= 1024);
    };
    checkDesktop();
    window.addEventListener("resize", checkDesktop);
    return () => window.removeEventListener("resize", checkDesktop);
  }, []);

  // Persist sidebar state to localStorage
  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("sidebarOpen", String(sidebarOpen));
      localStorage.setItem("sidebarCollapsed", String(sidebarCollapsed));
    }
  }, [sidebarOpen, sidebarCollapsed]);

  const handleNewConversation = () => {
    // Immediately clear chat state
    clearChat();
    selectConversation("");
    // Navigate to new conversation
    router.push("/conversations/new");
  };

  const handleConversationSelect = () => {
    // Close sidebar on mobile when conversation is selected
    if (typeof window !== "undefined" && window.innerWidth < 1024) {
      setSidebarOpen(false);
    }
  };

  const toggleSidebar = () => {
    // On mobile: toggle overlay
    // On desktop: toggle collapsed state
    if (typeof window !== "undefined" && window.innerWidth < 1024) {
      setSidebarOpen((prev) => !prev);
    } else {
      setSidebarCollapsed((prev) => !prev);
    }
  };

  const closeSidebar = () => {
    setSidebarOpen(false);
  };

  return (
    <div className="flex h-screen overflow-hidden bg-white dark:bg-neutral-900">
      {/* Overlay - only on mobile when sidebar is open */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 transition-opacity duration-300 lg:hidden"
          onClick={closeSidebar}
        />
      )}

      {/* Sidebar */}
      <div
        className={`
          fixed lg:relative
          left-0 top-0 bottom-0
          ${sidebarCollapsed ? "w-16" : "w-64"}
          shrink-0
          border-r border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-950
          flex flex-col z-40
          transition-all duration-300 ease-in-out
          shadow-lg lg:shadow-none
          ${sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}
        `}
      >
        <div className="border-b border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900 shrink-0">
          <div className="flex items-center gap-2">
            <Button
              onClick={closeSidebar}
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0 lg:hidden"
            >
              <X className="h-4 w-4" />
            </Button>
            <Button 
              onClick={handleNewConversation} 
              className={`${sidebarCollapsed ? "flex-1 justify-center px-0" : "flex-1"} text-sm min-w-0`}
              size="sm"
              variant="default"
            >
              <Plus className={`h-4 w-4 ${sidebarCollapsed ? "" : "mr-2"} shrink-0`} />
              {!sidebarCollapsed && <span className="truncate">New chat</span>}
            </Button>
          </div>
        </div>
        <div className="flex-1 overflow-hidden">
          <ConversationList onConversationSelect={handleConversationSelect} collapsed={sidebarCollapsed} />
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 min-w-0 flex flex-col w-full">
        {/* Header with toggle button - fixed on mobile, sticky on desktop */}
        <div className="sticky top-0 z-20 border-b border-neutral-200 bg-white/95 backdrop-blur-sm dark:border-neutral-800 dark:bg-neutral-900/95 px-4 py-3 shrink-0 flex items-center gap-3 sm:px-6 lg:relative lg:z-auto lg:bg-white lg:dark:bg-neutral-900">
          <Button
            onClick={toggleSidebar}
            variant="ghost"
            size="icon"
            className="h-9 w-9 shrink-0 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-all active:scale-95"
            aria-label="Toggle sidebar"
          >
            {isDesktop ? (
              sidebarCollapsed ? (
                <PanelLeftOpen className="h-5 w-5 text-neutral-700 dark:text-neutral-300" />
              ) : (
                <PanelLeftClose className="h-5 w-5 text-neutral-700 dark:text-neutral-300" />
              )
            ) : (
              <Menu className="h-5 w-5 text-neutral-700 dark:text-neutral-300" />
            )}
          </Button>
          <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-50 truncate">
            Heritage App
          </h1>
        </div>

        {selectedConversationId ? (
          <ChatWindow conversationId={selectedConversationId} sidebarOpen={sidebarOpen} />
        ) : (
          <div className="flex h-full items-center justify-center p-4">
            <div className="text-center max-w-md">
              <h2 className="mb-2 text-lg font-semibold text-neutral-700 dark:text-neutral-300 sm:text-xl">
                How can I help you today?
              </h2>
              <p className="mb-4 text-sm text-neutral-500 dark:text-neutral-400">
                Select a conversation or start a new one
              </p>
              <Button
                onClick={handleNewConversation}
                className="mt-2"
                variant="outline"
              >
                <Plus className="mr-2 h-4 w-4" />
                New Conversation
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}



