"use client";

import { useEffect, useRef } from "react";
import { ChatMessage } from "./ChatMessage";
import { TypingIndicator } from "./TypingIndicator";
import { MarkdownContent } from "./MarkdownContent";
import { useChatStore } from "@/store/chatStore";
import { Spinner } from "@/components/ui/spinner";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Bot } from "lucide-react";

interface MessageListProps {
  conversationId?: string;
}

export function MessageList({ conversationId }: MessageListProps) {
  const { messages, isLoading, isStreaming, currentStreamingContent, currentConversationId } =
    useChatStore();
  const scrollRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // CRITICAL: Filter messages to only show those for the current conversation
  // This prevents showing messages from a different conversation
  const filteredMessages = conversationId && currentConversationId === conversationId
    ? messages.filter(msg => msg.conversation_id === conversationId)
    : messages;

  useEffect(() => {
    // Auto-scroll to bottom when new messages arrive
    // Only scroll if messages belong to current conversation
    if (scrollRef.current && containerRef.current && conversationId === currentConversationId) {
      const container = containerRef.current;
      // Use setTimeout to ensure DOM is updated
      setTimeout(() => {
        container.scrollTo({
          top: container.scrollHeight,
          behavior: "smooth",
        });
      }, 100);
    }
  }, [filteredMessages, isStreaming, currentStreamingContent, conversationId, currentConversationId]);

  // Show loading spinner only when loading and we have a conversationId but no messages yet
  // AND the conversationId matches what we're loading
  if (isLoading && conversationId && conversationId === currentConversationId && filteredMessages.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="h-6 w-6 text-neutral-400" />
      </div>
    );
  }

  // Empty state - only show if not loading, no conversation, and no messages
  if (filteredMessages.length === 0 && !isStreaming && !isLoading && !conversationId) {
    return (
      <div className="flex h-full items-center justify-center px-4">
        <div className="text-center max-w-md">
          <h2 className="mb-2 text-lg font-semibold text-neutral-700 dark:text-neutral-300 sm:text-xl">
            How can I help you today?
          </h2>
          <p className="text-xs text-neutral-500 dark:text-neutral-400 sm:text-sm">
            Ask a question about Ga language or start learning
          </p>
        </div>
      </div>
    );
  }

  // Check if we're waiting for a response (user sent message but no response yet)
  const lastMessage = filteredMessages[filteredMessages.length - 1];
  const isWaitingForResponse = 
    isLoading && 
    lastMessage?.role === "user" && 
    !isStreaming && 
    !currentStreamingContent;

  return (
    <div ref={containerRef} className="h-full overflow-y-auto scroll-smooth">
      <div className="mx-auto flex max-w-4xl flex-col px-3 py-4 pb-32 sm:px-4 sm:py-6 sm:pb-36 md:px-6 md:py-8 md:pb-40">
        {filteredMessages.map((message) => (
          <ChatMessage key={message.id} message={message} />
        ))}
        
        {/* Show typing indicator when waiting for response */}
        {isWaitingForResponse && (
          <div className="py-6">
            <TypingIndicator />
          </div>
        )}
        
        {/* Show streaming content */}
        {isStreaming && currentStreamingContent && (
          <div className="flex w-full justify-start gap-2 py-4 sm:gap-4 sm:py-5 md:gap-5 md:py-6">
            <Avatar className="h-7 w-7 shrink-0 mt-1 sm:h-8 sm:w-8">
              <AvatarFallback className="bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200">
                <Bot className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              </AvatarFallback>
            </Avatar>
            <div className="max-w-[90%] rounded-xl bg-neutral-100 px-3 py-2.5 text-xs leading-6 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100 sm:max-w-[85%] sm:rounded-2xl sm:px-4 sm:py-3 sm:text-sm sm:leading-7 md:px-6 md:py-[18px]">
              <div className="relative">
                <MarkdownContent content={currentStreamingContent} />
                <span className="ml-1 inline-block h-3 w-0.5 animate-pulse bg-current sm:h-4" />
              </div>
            </div>
          </div>
        )}
        <div ref={scrollRef} />
      </div>
    </div>
  );
}

