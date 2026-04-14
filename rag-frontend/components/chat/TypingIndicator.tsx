"use client";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Bot } from "lucide-react";

export function TypingIndicator({ message = "Consulting Ga Archives..." }: { message?: string }) {
  return (
    <div className="flex w-full justify-start gap-4 py-6 sm:gap-5">
      <Avatar className="h-7 w-7 shrink-0 mt-1 sm:h-8 sm:w-8">
        <AvatarFallback className="bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200">
          <Bot className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
        </AvatarFallback>
      </Avatar>
      <div className="max-w-[85%] rounded-2xl bg-neutral-100 px-4 py-3 dark:bg-neutral-800 sm:px-6 sm:py-[18px]">
        <div className="flex flex-col gap-2">
          {message && (
            <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-neutral-400 dark:text-neutral-500">
              {message}
            </span>
          )}
          <div className="flex gap-1.5">
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-neutral-400 [animation-delay:-0.3s] dark:bg-neutral-500 sm:h-2 sm:w-2" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-neutral-400 [animation-delay:-0.15s] dark:bg-neutral-500 sm:h-2 sm:w-2" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-neutral-400 dark:bg-neutral-500 sm:h-2 sm:w-2" />
          </div>
        </div>
      </div>
    </div>
  );
}

