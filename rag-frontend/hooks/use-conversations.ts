import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getConversations } from "@/lib/api/conversations";
import { useConversationStore } from "@/store/conversationStore";

export const CONVERSATIONS_QUERY_KEY = ["conversations"];

export function useConversations(limit: number = 50) {
  const queryClient = useQueryClient();
  const { fetchConversations, conversations } = useConversationStore();

  const query = useQuery({
    queryKey: CONVERSATIONS_QUERY_KEY,
    queryFn: async () => {
      const data = await getConversations(limit);
      // Sync with Zustand store
      await fetchConversations();
      return data;
    },
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: CONVERSATIONS_QUERY_KEY });
  };

  return {
    ...query,
    // Read from Zustand so optimistically-added conversations appear immediately
    conversations,
    invalidate,
  };
}
