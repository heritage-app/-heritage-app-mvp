import { create } from "zustand";
import type { ConversationListItem } from "@/types";
import { getConversations } from "@/lib/api/conversations";

interface ConversationState {
  conversations: ConversationListItem[];
  isLoading: boolean;
  isInitialLoading: boolean;
  selectedConversationId: string | null;
  fetchConversations: () => Promise<void>;
  selectConversation: (id: string) => void;
  addConversation: (item: ConversationListItem) => void;
  updateConversationTitle: (id: string, title: string) => void;
}

export const useConversationStore = create<ConversationState>((set, get) => ({
  conversations: [],
  isLoading: false,
  isInitialLoading: true,
  selectedConversationId: null,

  fetchConversations: async () => {
    const isFirstLoad = get().conversations.length === 0;
    if (isFirstLoad) {
      set({ isInitialLoading: true });
    } else {
      set({ isLoading: true });
    }
    try {
      const response = await getConversations();
      // Sort by last_message_at (newest first)
      const sorted = response.conversations.sort((a, b) => {
        if (!a.last_message_at && !b.last_message_at) return 0;
        if (!a.last_message_at) return 1;
        if (!b.last_message_at) return -1;
        return (
          new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime()
        );
      });
      set({ conversations: sorted, isLoading: false, isInitialLoading: false });
    } catch (error) {
      console.error("Failed to fetch conversations:", error);
      set({ isLoading: false, isInitialLoading: false });
    }
  },

  selectConversation: (id: string) => {
    set({ selectedConversationId: id });
  },

  addConversation: (item: ConversationListItem) => {
    set((state) => ({
      conversations: [item, ...state.conversations],
    }));
  },

  updateConversationTitle: (id: string, title: string) => {
    set((state) => ({
      conversations: state.conversations.map((conv) =>
        conv.conversation_id === id ? { ...conv, title } : conv
      ),
    }));
  },
}));

