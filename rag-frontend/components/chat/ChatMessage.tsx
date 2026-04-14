"use client";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { MarkdownContent } from "./MarkdownContent";
import type { Message } from "@/types";
import { useUserStore } from "@/store/userStore";
import { User, Bot, Copy, Check, ThumbsUp, ThumbsDown, Share2, MoreHorizontal, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import { useState } from "react";
import { toast } from "sonner";

interface ChatMessageProps {
  message: Message;
}

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === "user";
  const isError = message.metadata?.isError === true;
  const [copied, setCopied] = useState(false);
  const displayName = useUserStore((state) => state.displayName);

  const handleCopy = async () => {
    if (isError) return;
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      toast.success("Copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      toast.error("Failed to copy");
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.5, ease: [0.4, 0, 0.2, 1] }}
      className={cn(
        "group relative flex w-full gap-3 sm:gap-4 py-4 sm:py-8",
        isUser ? "flex-row-reverse" : "flex-row"
      )}
    >
      <div className="flex flex-col gap-2 shrink-0">
        <Avatar className={cn(
          "h-10 w-10 shrink-0 transition-all duration-500 group-hover:scale-105",
          isUser 
            ? "border-2 border-primary/20" 
            : isError 
              ? "border-2 border-red-500/30 bg-red-500/10" 
              : "border-2 border-foreground/5 bg-background/50 backdrop-blur-xl"
        )}>
          <AvatarFallback className={cn(
            "text-[0.7rem] font-black tracking-widest uppercase mb-[-1px]",
            isUser ? "bg-white/10 text-white" : "bg-transparent text-white"
          )}>
            {isUser ? <User className="h-4 w-4" /> : isError ? <AlertCircle className="h-4 w-4 text-red-400" /> : <Bot className="h-4 w-4" />}
          </AvatarFallback>
        </Avatar>
      </div>

      <div
        className={cn(
          "relative flex flex-col gap-2 max-w-[96%] sm:max-w-[92%]",
          isUser ? "items-end" : "items-start"
        )}
      >
        <div className="flex items-center gap-3 px-1">
          <span className={cn(
            "text-[0.7rem] font-mono font-bold uppercase tracking-[0.4em]",
            isUser ? "text-white/40 mr-1" : isError ? "text-red-400" : "text-white ml-1"
          )}>
            {isUser ? displayName : isError ? "System Error" : "Linguistic Engine"}
          </span>
          {!isUser && !isError && (
            <div className="flex gap-1">
              <div className="h-1 w-1 rounded-full bg-primary/40 animate-pulse" />
              <div className="h-1 w-1 rounded-full bg-primary/20 animate-pulse delay-75" />
            </div>
          )}
        </div>

        <div
          className={cn(
            "relative px-5 py-3 text-[1rem] leading-7 transition-all duration-500",
            isUser
              ? "rounded-2xl bg-white/[0.03] border border-white/5 text-white w-full"
              : isError
                ? "rounded-2xl bg-red-500/5 border border-red-500/10 text-red-500/80 w-full"
                : "bg-transparent text-white max-w-none px-0"
          )}
        >
          <div className="prose prose-base prose-invert max-w-none">
            {isUser ? (
              <div className="whitespace-pre-wrap break-words [word-wrap:break-word] text-white text-[1rem]">
                {message.content}
              </div>
            ) : isError ? (
              <div className="whitespace-pre-wrap break-words [word-wrap:break-word] font-mono text-[0.7rem] uppercase tracking-wider">
                {message.content}
              </div>
            ) : (
              <MarkdownContent content={message.content} />
            )}
          </div>
        </div>

        {/* Action Bar for assistant messages */}
        {!isUser && !isError && (
          <div className="flex items-center gap-1 mt-2 px-1 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
            <Button
              variant="ghost"
              size="icon"
              onClick={handleCopy}
              className="h-8 w-8 text-foreground/30 hover:text-foreground/60 rounded-lg"
              title="Copy"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
            </Button>
          </div>
        )}
      </div>
    </motion.div>
  );
}


