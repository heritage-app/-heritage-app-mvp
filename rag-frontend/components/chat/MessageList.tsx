"use client";

import { motion } from "framer-motion";
import { useEffect, useRef } from "react";
import { ChatMessage } from "./ChatMessage";
import { TypingIndicator } from "./TypingIndicator";
import { MarkdownContent } from "./MarkdownContent";
import { ChatInput } from "./ChatInput";
import { useChatStore } from "@/store/chatStore";
import { useUserStore } from "@/store/userStore";
import { useTypewriter } from "@/hooks/use-typewriter";
import { useMessages } from "@/hooks/use-messages";
import { Spinner } from "@/components/ui/spinner";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { 
  Bot, 
  Smile, 
  Scroll, 
  ShieldCheck, 
  Compass, 
  RotateCcw,
  Sparkles,
  Command
} from "lucide-react";

interface MessageListProps {
  conversationId?: string;
}

export function MessageList({ conversationId }: MessageListProps) {
  const { 
    isStreaming, 
    currentStreamingContent, 
    currentConversationId,
    messages: storeMessages,
    isLoading: isStoreLoading
  } = useChatStore();

  const { 
    messages: historicalMessages, 
    isLoading: isHistoryLoading,
    error: historyError
  } = useMessages(conversationId || null);

  const { displayedContent, isTyping } = useTypewriter(currentStreamingContent || "");
  const displayName = useUserStore((state) => state.displayName);
  const scrollRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Merge historical messages with any new messages in the store that aren't persisted yet
  const filteredMessages = [
    ...historicalMessages,
    ...storeMessages.filter(m => !historicalMessages.some(hm => hm.id === m.id || hm.created_at === m.created_at))
  ];

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
  const SUGGESTED_QUERIES = [
    { 
      label: "Hospitality", 
      query: "How do I welcome a guest with honor in Ga?", 
      icon: Smile,
      description: "Learn the protocols of Akwaaba and local greetings."
    },
    { 
      label: "Scripture", 
      query: "Translate Genesis 1:1 and explain its linguistic roots.", 
      icon: Scroll,
      description: "Explore the rhythmic structure of Ga biblical text."
    },
    { 
      label: "Governance", 
      query: "How is the Mantse addressed in traditional councils?", 
      icon: ShieldCheck,
      description: "Understand the register used in traditional leadership."
    },
    { 
      label: "Preservation", 
      query: "What is the status of Ga language records in the archive?", 
      icon: Compass,
      description: "Search the linguistic engine's historical repository."
    },
  ];

  if (filteredMessages.length === 0 && !isStreaming && !isLoading && !conversationId) {
    return (
      <div className="flex h-full items-center justify-center px-4 overflow-y-auto pt-20 pb-12">
        <div className="text-left w-full max-w-4xl space-y-12">
          {/* Reference Header Style */}
          <div className="space-y-4">
            <h2 className="text-3xl font-black text-white tracking-tighter leading-[1.1] sm:text-4xl md:text-5xl">
              Hi there, <span className="bg-gradient-to-r from-primary via-[#e6c17a] to-primary/60 bg-clip-text text-transparent">{displayName}</span> <br />
              What would you like to know?
            </h2>
            <p className="text-sm font-medium tracking-tight text-foreground/50 max-w-lg leading-relaxed">
              Use one of the most common prompts below or use your own to begin
            </p>
          </div>

          <div className="py-10">
            <ChatInput variant="hero" isStatic={true} className="!max-w-none px-0" containerClassName="py-0" />
          </div>

          {/* Suggested Queries Grid Removed */}

          <button className="flex items-center gap-2 text-[0.65rem] font-mono font-bold uppercase tracking-[0.2em] text-foreground/50 hover:text-primary transition-all group">
            <RotateCcw className="h-3 w-3 transition-transform group-hover:rotate-180 duration-500" />
            Refresh Prompts
          </button>
        </div>
      </div>
    );
  }

  // Check if we're waiting for a response (user sent message but no response yet)
  const lastMessage = filteredMessages[filteredMessages.length - 1];
  const isThinking = 
    (isHistoryLoading || isStoreLoading) && 
    lastMessage?.role === "user" && 
    !isStreaming && 
    !currentStreamingContent;

  return (
    <div ref={containerRef} className="h-full overflow-y-auto scroll-smooth">
      <div className="mx-auto flex max-w-4xl flex-col px-3 pt-16 pb-12 sm:px-4 sm:pt-6 sm:pb-12 md:px-6 md:pt-8 md:pb-12 lg:pt-8">
        {filteredMessages.map((message) => (
          <ChatMessage key={message.id} message={message} />
        ))}
        
        {/* Show typing indicator (thinking) when waiting for response */}
        {isThinking && (
          <div className="py-2">
            <TypingIndicator message="Consulting Heritage Archives..." />
          </div>
        )}
        
        {/* Show streaming content */}
        {(isStreaming || isTyping) && (displayedContent || currentStreamingContent) && (
          <div className="flex w-full justify-start gap-2 py-4 sm:gap-4 sm:py-5 md:gap-5 md:py-6">
            <Avatar className="h-7 w-7 shrink-0 mt-1 sm:h-8 sm:w-8">
              <AvatarFallback className="bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200">
                <Bot className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              </AvatarFallback>
            </Avatar>
            <div className="max-w-[90%] rounded-xl bg-neutral-100 px-3 py-2.5 text-xs leading-6 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100 sm:max-w-[85%] sm:rounded-2xl sm:px-4 sm:py-3 sm:text-sm sm:leading-7 md:px-6 md:py-[18px]">
              <div className="relative">
                <MarkdownContent content={displayedContent} />
                <span className={cn(
                  "ml-1 inline-block h-3 w-0.5 bg-current sm:h-4",
                  (isTyping || isStreaming) ? "animate-pulse" : "hidden"
                )} />
              </div>
            </div>
          </div>
        )}
        <div ref={scrollRef} />
      </div>
    </div>
  );
}

