import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getConversationMessages } from "@/lib/api/conversations";
import { useChatStore } from "@/store/chatStore";
import { CONVERSATIONS_QUERY_KEY } from "./use-conversations";

export const MESSAGES_QUERY_KEY = (conversationId: string | null) => ["messages", conversationId];

export function useMessages(conversationId: string | null) {
  const queryClient = useQueryClient();
  const chatStore = useChatStore();

  const query = useQuery({
    queryKey: MESSAGES_QUERY_KEY(conversationId),
    queryFn: async () => {
      if (!conversationId) return { messages: [] };
      const data = await getConversationMessages(conversationId);
      // Synchronize with store for UI consistency
      if (data && data.messages) {
        chatStore.setConversationId(conversationId);
        chatStore.addMessage = (msg) => {}; // No-op during initial sync
        // Using set directly via store state if possible, or just let components read query
      }
      return data;
    },
    enabled: !!conversationId,
  });

  const sendMessageMutation = useMutation({
    mutationFn: async ({ query, model }: { query: string; model?: string }) => {
      // Invalidate conversation list immediately to reflect "activity"
      queryClient.invalidateQueries({ queryKey: CONVERSATIONS_QUERY_KEY });
      
      // The actual streaming logic is still handled by chatStore.sendMessage
      // because it needs to manage complex transient state (isStreaming, currentStreamingContent)
      await chatStore.sendMessage(query, model);
    },
    onSuccess: () => {
      // After message is complete, invalidate the specific conversation message cache
      if (conversationId) {
        queryClient.invalidateQueries({ queryKey: MESSAGES_QUERY_KEY(conversationId) });
      }
      queryClient.invalidateQueries({ queryKey: CONVERSATIONS_QUERY_KEY });
    },
  });

  return {
    ...query,
    messages: query.data?.messages || [],
    sendMessage: sendMessageMutation.mutate,
    isSending: sendMessageMutation.isPending,
    sendError: sendMessageMutation.error,
  };
}
