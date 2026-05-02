"use client";

import { MessageList } from "./MessageList";
import { ChatInput } from "./ChatInput";
import { useChatStore } from "@/store/chatStore";
import { cn } from "@/lib/utils";
import { useEffect, useRef } from "react";
import { Spinner } from "@/components/ui/spinner";

interface ChatWindowProps {
  conversationId?: string;
  sidebarOpen?: boolean;
}

export function ChatWindow({ conversationId, sidebarOpen = false }: ChatWindowProps) {
  const { setConversationId, clearChat, isLoading, messages, currentConversationId } = useChatStore();
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
        // Switching to a conversation - clear and set immediately
        // useMessages query in MessageList will handle the actual fetching
        setConversationId(currentId);
      } else {
        // Clearing chat (new conversation)
        clearChat();
      }
    }
  }, [normalizedConversationId, setConversationId, clearChat]);

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
    <div key={normalizedConversationId || "new"} className="flex h-full flex-col bg-background relative overflow-hidden">
      {/* Background Cinematic Texture */}
      <div className="absolute inset-0 -z-10 cultural-pattern opacity-[0.02]" />
      
      <div className="flex-1 overflow-hidden min-h-0 relative">
        {isRestoringConversation ? (
          <div className="flex h-full items-center justify-center">
            <div className="flex flex-col items-center gap-4">
              <Spinner className="h-8 w-8 text-primary/40" />
              <span className="text-[0.6rem] font-bold uppercase tracking-[0.3em] text-primary/20 animate-pulse">Synchronizing Heritage...</span>
            </div>
          </div>
        ) : (
          <MessageList conversationId={normalizedConversationId} />
        )}
      </div>
      {messages.length > 0 && (
        <div className="shrink-0 bg-background pb-2 sm:pb-3 md:pb-4 pt-1 sm:pt-2">
          <div className="mx-auto max-w-4xl px-2 sm:px-4 md:px-6 lg:px-8">
            <ChatInput 
              variant="compact" 
              isStatic={true} 
              className="!max-w-none px-0" 
              containerClassName="py-0"
              inputClassName={cn(
                "w-full bg-transparent border-0 focus:ring-0 resize-none py-1.5 text-[13px] sm:text-[14px] md:text-[15px] leading-relaxed scrollbar-hide",
                "min-h-[28px] sm:min-h-[30px]"
              )}
            />
            <div className="mt-2 sm:mt-3 text-center">
              <span className="text-[9px] sm:text-[10px] md:text-[0.6rem] font-medium text-foreground/20 px-2 sm:px-4 italic">
                Heritage App can make mistakes. Check important info.
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

