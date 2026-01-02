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
    return (
      <button
        className={cn(
          "w-full cursor-pointer rounded-lg p-2 flex items-center justify-center transition-colors",
          "hover:bg-neutral-100 dark:hover:bg-neutral-800",
          "active:scale-[0.98]",
          isSelected && "bg-neutral-200 dark:bg-neutral-800"
        )}
        onClick={onClick}
        title={conversation.title || "New Conversation"}
      >
        <MessageSquare className="h-5 w-5 text-neutral-600 dark:text-neutral-400" />
      </button>
    );
  }

  return (
    <button
      className={cn(
        "w-full cursor-pointer rounded-lg px-3 py-2.5 text-left text-sm transition-colors",
        "hover:bg-neutral-100 dark:hover:bg-neutral-800",
        "active:scale-[0.98]",
        isSelected && "bg-neutral-200 dark:bg-neutral-800"
      )}
      onClick={onClick}
    >
      <div className="flex-1 min-w-0">
        <h3 className="truncate font-medium text-neutral-900 dark:text-neutral-100 text-sm">
          {conversation.title || "New Conversation"}
        </h3>
        {conversation.last_message_at && (
          <p className="mt-1 truncate text-xs text-neutral-500 dark:text-neutral-400">
            {formatDate(conversation.last_message_at)}
          </p>
        )}
      </div>
    </button>
  );
}


