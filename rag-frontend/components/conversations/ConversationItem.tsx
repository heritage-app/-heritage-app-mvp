"use client";

import { formatDate } from "@/lib/utils/formatDate";
import type { ConversationListItem } from "@/types";
import { cn } from "@/lib/utils";

interface ConversationItemProps {
  conversation: ConversationListItem;
  isSelected: boolean;
  onClick: () => void;
}

export function ConversationItem({
  conversation,
  isSelected,
  onClick,
}: ConversationItemProps) {
  return (
    <button
      className={cn(
        "w-full cursor-pointer rounded-lg px-3 py-2.5 text-left text-sm transition-colors",
        "hover:bg-neutral-100 dark:hover:bg-neutral-800",
        isSelected && "bg-neutral-200 dark:bg-neutral-800"
      )}
      onClick={onClick}
    >
      <div className="flex-1 min-w-0">
        <h3 className="truncate font-medium text-neutral-900 dark:text-neutral-100">
          {conversation.title || "New Conversation"}
        </h3>
        {conversation.last_message_at && (
          <p className="mt-0.5 truncate text-xs text-neutral-500 dark:text-neutral-400">
            {formatDate(conversation.last_message_at)}
          </p>
        )}
      </div>
    </button>
  );
}


