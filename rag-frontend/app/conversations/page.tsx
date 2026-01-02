"use client";

import { ConversationList } from "@/components/conversations/ConversationList";
import { ChatWindow } from "@/components/chat/ChatWindow";
import { Button } from "@/components/ui/button";
import { Plus, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useConversationStore } from "@/store/conversationStore";
import { useChatStore } from "@/store/chatStore";
import { useEffect } from "react";

export default function ConversationsPage() {
  const router = useRouter();
  const { selectedConversationId, selectConversation } = useConversationStore();
  const { clearChat } = useChatStore();

  const handleNewConversation = () => {
    // Immediately clear chat state
    clearChat();
    selectConversation("");
    // Navigate to new conversation
    router.push("/conversations/new");
  };

  return (
    <div className="flex h-screen overflow-hidden bg-white dark:bg-neutral-900">
      <div className="fixed left-0 top-0 bottom-0 w-64 shrink-0 border-r border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-950 flex flex-col z-20">
        <div className="border-b border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900 shrink-0">
          <div className="flex gap-2">
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
          <ConversationList />
        </div>
      </div>
      <div className="flex-1 min-w-0 flex flex-col ml-64">
        {selectedConversationId ? (
          <ChatWindow conversationId={selectedConversationId} />
        ) : (
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <h2 className="mb-2 text-xl font-semibold text-neutral-700 dark:text-neutral-300">
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


