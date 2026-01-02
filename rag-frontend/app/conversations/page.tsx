"use client";

import { ConversationList } from "@/components/conversations/ConversationList";
import { ChatWindow } from "@/components/chat/ChatWindow";
import { Button } from "@/components/ui/button";
import { Plus, Menu, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useConversationStore } from "@/store/conversationStore";
import { useChatStore } from "@/store/chatStore";
import { useState, useEffect } from "react";

export default function ConversationsPage() {
  const router = useRouter();
  const { selectedConversationId, selectConversation } = useConversationStore();
  const { clearChat } = useChatStore();
  
  // Initialize sidebar state from localStorage, default to false (closed)
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
        {/* Header with toggle button - fixed on mobile, sticky on desktop */}
        <div className="sticky top-0 z-20 border-b border-neutral-200 bg-white/95 backdrop-blur-sm dark:border-neutral-800 dark:bg-neutral-900/95 px-4 py-3 shrink-0 flex items-center gap-3 sm:px-6 lg:relative lg:z-auto lg:bg-white lg:dark:bg-neutral-900">
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



