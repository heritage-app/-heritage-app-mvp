"use client";

import { useEffect } from "react";
import { useConversationStore } from "@/store/conversationStore";
import { ConversationItem } from "./ConversationItem";
import { Card } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

export function ConversationList() {
  const {
    conversations,
    isInitialLoading,
    selectedConversationId,
    fetchConversations,
    selectConversation,
  } = useConversationStore();
  const router = useRouter();

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  const handleNewConversation = () => {
    // Immediately clear chat state before navigation
    selectConversation("");
    // Navigate to new conversation
    router.push("/conversations/new");
  };

  const handleConversationClick = (id: string) => {
    selectConversation(id);
    router.push(`/conversations/${id}`);
  };

  if (isInitialLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      {conversations.length === 0 ? (
        <div className="flex h-full items-center justify-center p-4">
          <div className="text-center">
            <p className="text-sm text-neutral-500 dark:text-neutral-400">
              No conversations yet
            </p>
          </div>
        </div>
      ) : (
        <div className="p-2">
          {conversations.map((conversation) => (
            <ConversationItem
              key={conversation.conversation_id}
              conversation={conversation}
              isSelected={selectedConversationId === conversation.conversation_id}
              onClick={() => handleConversationClick(conversation.conversation_id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}


