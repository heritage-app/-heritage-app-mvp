import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getConversations } from "@/lib/api/conversations";
import { useConversationStore } from "@/store/conversationStore";

export const CONVERSATIONS_QUERY_KEY = ["conversations"];

export function useConversations(limit: number = 50) {
  const queryClient = useQueryClient();
  const { setConversations } = useConversationStore();

  const query = useQuery({
    queryKey: CONVERSATIONS_QUERY_KEY,
    queryFn: async () => {
      const data = await getConversations(limit);
      // Sync with Zustand for components that still rely on it
      if (data && data.conversations) {
        setConversations(data.conversations);
      }
      return data;
    },
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: CONVERSATIONS_QUERY_KEY });
  };

  return {
    ...query,
    conversations: query.data?.conversations || [],
    invalidate,
  };
}
