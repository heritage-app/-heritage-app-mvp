"use client";

import { formatDate } from "@/lib/utils/formatDate";
import type { ConversationListItem } from "@/types";
import { cn } from "@/lib/utils";

import { MessageSquare } from "lucide-react";

interface ConversationItemProps {
  conversation: ConversationListItem;
  isSelected: boolean;
  onClick: () => void;
  collapsed?: boolean;
}

export function ConversationItem({
  conversation,
  isSelected,
  onClick,
  collapsed = false,
}: ConversationItemProps) {
  if (collapsed) {
    return null;
  }

  return (
    <button
      className={cn(
        "group w-full cursor-pointer rounded-xl px-3 py-2 text-left transition-all duration-300",
        "relative overflow-hidden",
        "active:scale-[0.98]",
        isSelected 
          ? "bg-[#212121] text-foreground" 
          : "text-foreground/50 hover:bg-white/[0.03] hover:text-foreground/80"
      )}
      onClick={onClick}
    >
      <div className="flex-1 min-w-0 relative z-10">
        <div className="flex items-center justify-between gap-2 overflow-hidden">
          <h3 className={cn(
            "truncate text-[13px] font-medium tracking-tight py-0.5 transition-colors",
            isSelected ? "text-foreground" : "text-foreground/70 group-hover:text-foreground"
          )}>
            {conversation.title || "New Conversation"}
          </h3>
          {isSelected && <div className="h-1 w-1 rounded-full bg-primary shrink-0" />}
        </div>
      </div>
    </button>
  );
}


