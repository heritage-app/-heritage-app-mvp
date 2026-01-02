"use client";

import { ChatWindow } from "@/components/chat/ChatWindow";
import { ConversationList } from "@/components/conversations/ConversationList";
import { Button } from "@/components/ui/button";
import { Plus, Menu, X } from "lucide-react";
import { useRouter, useParams } from "next/navigation";
import { useConversationStore } from "@/store/conversationStore";
import { useChatStore } from "@/store/chatStore";
import { useEffect, useState } from "react";

export default function ConversationDetailPage() {
  const router = useRouter();
  const params = useParams();
  const conversationId = params.id as string;
  const { selectConversation } = useConversationStore();
  const { clearChat } = useChatStore();

  // Initialize sidebar state from localStorage
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("sidebarOpen");
      return saved === "true";
    }
    return false;
  });

  // Persist sidebar state to localStorage
  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("sidebarOpen", String(sidebarOpen));
    }
  }, [sidebarOpen]);

  useEffect(() => {
    if (conversationId && conversationId !== "new") {
      selectConversation(conversationId);
    } else if (conversationId === "new") {
      // Immediately clear chat when "new" is detected
      clearChat();
      selectConversation("");
    }
  }, [conversationId, selectConversation, clearChat]);

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
    setSidebarOpen((prev) => !prev);
  };

  return (
    <div className="flex h-screen overflow-hidden bg-white dark:bg-neutral-900">
      {/* Overlay - shown when sidebar is open on all screen sizes */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 transition-opacity duration-300"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar - always overlay, never pushes content */}
      <div
        className={`fixed left-0 top-0 bottom-0 w-64 shrink-0 border-r border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-950 flex flex-col z-40 transition-transform duration-300 ease-in-out shadow-lg ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="border-b border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900 shrink-0">
          <div className="flex items-center gap-2">
            <Button
              onClick={() => setSidebarOpen(false)}
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
            >
              <X className="h-4 w-4" />
            </Button>
            <Button 
              onClick={handleNewConversation} 
              className="flex-1 text-sm min-w-0" 
              size="sm"
              variant="default"
            >
              <Plus className="mr-2 h-4 w-4 shrink-0" />
              <span className="truncate">New chat</span>
            </Button>
          </div>
        </div>
        <div className="flex-1 overflow-hidden">
          <ConversationList onConversationSelect={handleConversationSelect} />
        </div>
      </div>

      {/* Main Content - always full width, never shifted */}
      <div className="flex-1 min-w-0 flex flex-col w-full">
        {/* Header with toggle button - shown on all screen sizes */}
        <div className="border-b border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900 px-4 py-3 shrink-0 flex items-center gap-3 sm:px-6">
          <Button
            onClick={toggleSidebar}
            variant="ghost"
            size="icon"
            className="h-9 w-9 shrink-0 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-all active:scale-95"
            aria-label="Toggle sidebar"
          >
            <Menu className="h-5 w-5 text-neutral-700 dark:text-neutral-300" />
          </Button>
          <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-50 truncate">
            Heritage App
          </h1>
        </div>

        <ChatWindow
          conversationId={conversationId === "new" ? undefined : conversationId}
          sidebarOpen={sidebarOpen}
        />
      </div>
    </div>
  );
}



