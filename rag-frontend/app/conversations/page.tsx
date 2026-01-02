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
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const handleNewConversation = () => {
    // Immediately clear chat state
    clearChat();
    selectConversation("");
    // Close sidebar on mobile
    setSidebarOpen(false);
    // Navigate to new conversation
    router.push("/conversations/new");
  };

  const handleConversationSelect = () => {
    // Close sidebar on mobile when conversation is selected
    setSidebarOpen(false);
  };

  // Close sidebar when conversation is selected on mobile
  useEffect(() => {
    if (selectedConversationId) {
      setSidebarOpen(false);
    }
  }, [selectedConversationId]);

  return (
    <div className="flex h-screen overflow-hidden bg-white dark:bg-neutral-900">
      {/* Mobile Overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <div
        className={`fixed left-0 top-0 bottom-0 w-64 shrink-0 border-r border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-950 flex flex-col z-40 transition-transform duration-300 ease-in-out lg:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="border-b border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900 shrink-0">
          <div className="flex items-center gap-2">
            <Button
              onClick={() => setSidebarOpen(false)}
              variant="ghost"
              size="icon"
              className="lg:hidden h-8 w-8"
            >
              <X className="h-4 w-4" />
            </Button>
            <Button 
              onClick={handleNewConversation} 
              className="flex-1 text-sm" 
              size="sm"
              variant="default"
            >
              <Plus className="mr-2 h-4 w-4" />
              New chat
            </Button>
          </div>
        </div>
        <div className="flex-1 overflow-hidden">
          <ConversationList onConversationSelect={handleConversationSelect} />
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 min-w-0 flex flex-col lg:ml-64">
        {/* Mobile Header */}
        <div className="lg:hidden border-b border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900 p-3 shrink-0 flex items-center gap-2">
          <Button
            onClick={() => setSidebarOpen(true)}
            variant="ghost"
            size="icon"
            className="h-9 w-9"
          >
            <Menu className="h-5 w-5" />
          </Button>
          <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-50">
            Heritage App
          </h1>
        </div>

        {selectedConversationId ? (
          <ChatWindow conversationId={selectedConversationId} />
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



