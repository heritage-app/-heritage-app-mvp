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
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <h2 className="mb-2 text-xl font-semibold text-neutral-700 dark:text-neutral-300">
            How can I help you today?
          </h2>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            Ask a question about heritage documents
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
    <div ref={containerRef} className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-4xl flex-col px-6 py-8">
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
          <div className="flex w-full justify-start gap-5 py-6">
            <Avatar className="h-8 w-8 shrink-0 mt-1">
              <AvatarFallback className="bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200">
                <Bot className="h-4 w-4" />
              </AvatarFallback>
            </Avatar>
            <div className="max-w-[85%] rounded-2xl bg-neutral-100 px-6 py-[18px] text-sm leading-7 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100">
              <div className="relative">
                <MarkdownContent content={currentStreamingContent} />
                <span className="ml-1 inline-block h-4 w-0.5 animate-pulse bg-current" />
              </div>
            </div>
          </div>
        )}
        <div ref={scrollRef} />
      </div>
    </div>
  );
}

