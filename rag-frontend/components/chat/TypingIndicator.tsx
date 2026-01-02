"use client";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Bot } from "lucide-react";

export function TypingIndicator() {
  return (
    <div className="flex w-full justify-start gap-5 py-6">
      <Avatar className="h-8 w-8 shrink-0 mt-1">
        <AvatarFallback className="bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200">
          <Bot className="h-4 w-4" />
        </AvatarFallback>
      </Avatar>
      <div className="max-w-[85%] rounded-2xl bg-neutral-100 px-6 py-[18px] dark:bg-neutral-800">
        <div className="flex gap-1.5">
          <span className="h-2 w-2 animate-bounce rounded-full bg-neutral-400 [animation-delay:-0.3s] dark:bg-neutral-500" />
          <span className="h-2 w-2 animate-bounce rounded-full bg-neutral-400 [animation-delay:-0.15s] dark:bg-neutral-500" />
          <span className="h-2 w-2 animate-bounce rounded-full bg-neutral-400 dark:bg-neutral-500" />
        </div>
      </div>
    </div>
  );
}

