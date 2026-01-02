"use client";

import { ChatWindow } from "@/components/chat/ChatWindow";
import { ConversationList } from "@/components/conversations/ConversationList";
import { Button } from "@/components/ui/button";
import { Upload, Plus } from "lucide-react";
import { useRouter, useParams } from "next/navigation";
import { useConversationStore } from "@/store/conversationStore";
import { useChatStore } from "@/store/chatStore";
import { useEffect } from "react";

export default function ConversationDetailPage() {
  const router = useRouter();
  const params = useParams();
  const conversationId = params.id as string;
  const { selectConversation } = useConversationStore();
  const { clearChat } = useChatStore();

  useEffect(() => {
    if (conversationId && conversationId !== "new") {
      selectConversation(conversationId);
    } else if (conversationId === "new") {
      // Immediately clear chat when "new" is detected
      clearChat();
      selectConversation("");
    }
  }, [conversationId, selectConversation, clearChat]);

  const handleNewConversation = () => {
    // Immediately clear chat state
    clearChat();
    selectConversation("");
    // Navigate to new conversation
    router.push("/conversations/new");
  };

  return (
    <div className="flex h-screen overflow-hidden bg-white dark:bg-neutral-900">
      <div className="fixed left-0 top-0 bottom-0 w-64 shrink-0 border-r border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-950 flex flex-col z-20">
        <div className="border-b border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900 shrink-0">
          <div className="flex gap-2">
            <Button 
              onClick={handleNewConversation} 
              className="flex-1 text-sm" 
              size="sm"
              variant="default"
            >
              <Plus className="mr-2 h-4 w-4" />
              New chat
            </Button>
          </div>
        </div>
        <div className="flex-1 overflow-hidden">
          <ConversationList />
        </div>
      </div>
      <div className="flex-1 min-w-0 flex flex-col ml-64">
        <ChatWindow
          conversationId={conversationId === "new" ? undefined : conversationId}
        />
      </div>
    </div>
  );
}


