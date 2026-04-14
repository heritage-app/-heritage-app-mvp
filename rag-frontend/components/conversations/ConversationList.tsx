"use client";

import { useEffect } from "react";
import { useConversationStore } from "@/store/conversationStore";
import { ConversationItem } from "./ConversationItem";
import { Card } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Plus, Shield } from "lucide-react";
import { useUserStore } from "@/store/userStore";

interface ConversationListProps {
  onConversationSelect?: () => void;
  collapsed?: boolean;
}

export function ConversationList({ onConversationSelect, collapsed = false }: ConversationListProps) {
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
    onConversationSelect?.();
  };

  const { isLoaded, profile } = useUserStore();

  if (isInitialLoading || !isLoaded) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-6 text-center">
        {!collapsed && (
          <>
            <div className="h-12 w-12 rounded-2xl bg-primary/5 border border-primary/10 flex items-center justify-center mb-4">
              <Plus className="h-6 w-6 text-primary/40" />
            </div>
            <h3 className="text-white text-[13px] font-bold mb-2">Login for History</h3>
            <p className="text-[11px] text-white/30 leading-relaxed max-w-[140px]">
              Secure your conversations and access them anywhere by joining the archive.
            </p>
          </>
        )}
        {collapsed && (
          <div className="h-8 w-8 rounded-lg bg-primary/5 border border-primary/10 flex items-center justify-center">
            <Shield className="h-3 w-3 text-primary/40" />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto scroll-smooth">
      {conversations.length === 0 ? (
        <div className="flex h-full items-center justify-center p-4">
          <div className={`text-center ${collapsed ? "px-1" : ""}`}>
            {!collapsed && (
              <p className="text-[12px] text-foreground/20 font-medium">
                No recent chats
              </p>
            )}
          </div>
        </div>
      ) : (
        <div className={`p-2 space-y-1 ${collapsed ? "px-1.5" : ""}`}>
          {conversations.map((conversation) => (
            <ConversationItem
              key={conversation.conversation_id}
              conversation={conversation}
              isSelected={selectedConversationId === conversation.conversation_id}
              onClick={() => handleConversationClick(conversation.conversation_id)}
              collapsed={collapsed}
            />
          ))}
        </div>
      )}
    </div>
  );
}


