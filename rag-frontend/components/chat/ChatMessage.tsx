"use client";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { MarkdownContent } from "./MarkdownContent";
import type { Message } from "@/types";
import { User, Bot, Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { toast } from "sonner";

interface ChatMessageProps {
  message: Message;
}

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === "user";
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
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
    <div
      className={cn(
        "group relative flex w-full gap-5 py-6",
        isUser ? "justify-end" : "justify-start"
      )}
    >
      {!isUser && (
        <Avatar className="h-8 w-8 shrink-0 mt-1">
          <AvatarFallback className="bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200">
            <Bot className="h-4 w-4" />
          </AvatarFallback>
        </Avatar>
      )}
      <div
        className={cn(
          "relative max-w-[85%] rounded-2xl px-6 py-[18px] text-sm leading-7",
          isUser
            ? "bg-neutral-900 text-white dark:bg-neutral-800"
            : "bg-neutral-100 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100"
        )}
      >
        {/* Copy button for assistant messages */}
        {!isUser && (
          <Button
            variant="ghost"
            size="icon"
            onClick={handleCopy}
            className={cn(
              "absolute -right-2 -top-2 h-8 w-8 opacity-0 transition-opacity group-hover:opacity-100",
              "bg-white dark:bg-neutral-800 shadow-md hover:bg-neutral-50 dark:hover:bg-neutral-700",
              "border border-neutral-200 dark:border-neutral-700"
            )}
          >
            {copied ? (
              <Check className="h-4 w-4 text-green-600" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
          </Button>
        )}
        
        {isUser ? (
          <div className="whitespace-pre-wrap break-words [word-wrap:break-word]">
            {message.content}
          </div>
        ) : (
          <MarkdownContent content={message.content} />
        )}
      </div>
      {isUser && (
        <Avatar className="h-8 w-8 shrink-0 mt-1">
          <AvatarFallback className="bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200">
            <User className="h-4 w-4" />
          </AvatarFallback>
        </Avatar>
      )}
    </div>
  );
}


