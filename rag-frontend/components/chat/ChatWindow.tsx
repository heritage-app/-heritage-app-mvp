"use client";

import { MessageList } from "./MessageList";
import { ChatInput } from "./ChatInput";
import { useChatStore } from "@/store/chatStore";
import { useEffect, useRef } from "react";
import { Spinner } from "@/components/ui/spinner";

interface ChatWindowProps {
  conversationId?: string;
}

export function ChatWindow({ conversationId }: ChatWindowProps) {
  const { loadConversation, setConversationId, clearChat, isLoading, messages, currentConversationId } = useChatStore();
  const prevConversationIdRef = useRef<string | undefined>(undefined);
  const normalizedConversationId = conversationId === "new" ? undefined : conversationId;

  useEffect(() => {
    // CRITICAL: Always react to conversationId changes
    // This ensures the component responds to route changes immediately
    const currentId = normalizedConversationId;
    const previousId = prevConversationIdRef.current;

    // If conversationId changed, immediately handle it
    if (currentId !== previousId) {
      console.log("🔄 Conversation ID changed:", { from: previousId, to: currentId });
      
      // Update ref immediately
      prevConversationIdRef.current = currentId;
      
      if (currentId) {
        // Switching to a conversation - clear and load immediately
        console.log("📥 Loading conversation:", currentId);
        // Clear messages FIRST (synchronous)
        setConversationId(currentId);
        // Then load (async)
        loadConversation(currentId);
      } else {
        // Clearing chat (new conversation)
        console.log("🧹 Clearing chat - New conversation");
        // Immediately clear all chat state
        clearChat();
      }
    }
  }, [normalizedConversationId, setConversationId, loadConversation, clearChat]);

  // Show loading when:
  // 1. We're loading
  // 2. We have a conversationId
  // 3. Messages are empty (cleared, waiting for new data)
  // 4. The conversationId matches what we're loading
  const isRestoringConversation = 
    isLoading && 
    normalizedConversationId && 
    normalizedConversationId === currentConversationId &&
    messages.length === 0;

  // CRITICAL: Use key prop to force re-render when conversationId changes
  // This ensures the component tree resets when switching conversations
  return (
    <div key={normalizedConversationId || "new"} className="flex min-h-full flex-col bg-white dark:bg-neutral-900 py-10">
      <div className="flex-1 overflow-hidden">
        {isRestoringConversation ? (
          <div className="flex h-full items-center justify-center">
            <Spinner className="h-6 w-6 text-neutral-400" />
          </div>
        ) : (
          <MessageList conversationId={normalizedConversationId} />
        )}
      </div>
      <ChatInput />
    </div>
  );
}

