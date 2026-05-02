import { create } from "zustand";
import type { Message } from "@/types";
import { askQuestion, askNewQuestion } from "@/lib/api/chat";
import { getConversationMessages } from "@/lib/api/conversations";
import { useConversationStore } from "./conversationStore";

interface ChatState {
  currentConversationId: string | null;
  messages: Message[];
  isLoading: boolean;
  isStreaming: boolean;
  error: string | null;
  currentStreamingContent: string;
  selectedMode: string;
  setMode: (mode: string) => void;
  sendMessage: (query: string, model?: string) => Promise<void>;
  addMessage: (message: Message) => void;
  setConversationId: (id: string) => void;
  clearChat: () => void;
  loadConversation: (id: string) => Promise<void>;
  updateStreamingContent: (content: string) => void;
  finishStreaming: () => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  currentConversationId: null,
  messages: [],
  isLoading: false,
  isStreaming: false,
  error: null,
  currentStreamingContent: "",
  selectedMode: "auto",

  setMode: (mode: string) => set({ selectedMode: mode }),

  sendMessage: async (query: string, model?: string) => {
    const { selectedMode } = get();
    set({ isLoading: true, error: null, isStreaming: false, currentStreamingContent: "" });

    const currentConversationId = get().currentConversationId;

    // Add user message immediately
    const userMessage: Message = {
      id: `user-${Date.now()}`,
      conversation_id: currentConversationId || "",
      role: "user",
      content: query,
      created_at: new Date().toISOString(),
    };

    set((state) => ({
      messages: [...state.messages, userMessage],
    }));

    try {
      // Use appropriate endpoint based on whether we have a conversation_id
      if (currentConversationId) {
        // Continue existing conversation
        console.log("📤 Continuing conversation:", currentConversationId, "with model:", model, "mode:", selectedMode);
        await askQuestion(currentConversationId, query, model, selectedMode, {
          onChunk: (chunk) => {
            set((state) => ({
              isStreaming: true,
              currentStreamingContent: state.currentStreamingContent + chunk,
            }));
          },
          onComplete: (message, conversationId) => {
            console.log("✅ Message complete, conversation_id:", conversationId);
            const previousConversationId = get().currentConversationId;
            
            set((state) => {
              const updatedMessages = [...state.messages];
              // Remove any temporary streaming message
              const filteredMessages = updatedMessages.filter(
                (msg) => msg.id !== `streaming-${conversationId}`
              );
              
              // Add the complete assistant message
              // CRITICAL: Store conversation_id from response for subsequent requests
              return {
                messages: [...filteredMessages, message],
                currentConversationId: conversationId, // Store conversation_id for next request
                isLoading: false,
                isStreaming: false,
                currentStreamingContent: "",
              };
            });

            // If this is a new conversation (no previous conversation_id), add it to the conversation list
            if (!previousConversationId && conversationId) {
              const conversationStore = useConversationStore.getState();
              // Check if conversation already exists in the list
              const exists = conversationStore.conversations.some(
                (conv) => conv.conversation_id === conversationId
              );
              if (!exists) {
                // Add new conversation optimistically so it appears immediately in sidebar
                conversationStore.addConversation({
                  conversation_id: conversationId,
                  title: null, // Title will be generated/updated by backend
                  last_message_at: new Date().toISOString(),
                });
                console.log("➕ Added new conversation to list:", conversationId);
                // Fetch again after delay to pick up server-generated title
                setTimeout(() => {
                  useConversationStore.getState().fetchConversations();
                }, 3000);
              }
            }
          },
          onError: (error) => {
            const errorMessage = error.message;
            console.error("❌ Chat Error:", errorMessage);

            // Add error as a persistent message
            const errorMsg: Message = {
              id: `error-${Date.now()}`,
              conversation_id: get().currentConversationId || "",
              role: "assistant",
              content: errorMessage,
              created_at: new Date().toISOString(),
              metadata: { isError: true }
            };

            set((state) => ({
              messages: [...state.messages, errorMsg],
              error: errorMessage,
              isLoading: false,
              isStreaming: false,
              currentStreamingContent: "",
            }));
          },
        });
      } else {
        // Start new conversation
        console.log("📤 Starting new conversation with model:", model, "mode:", selectedMode);
        await askNewQuestion(query, model, selectedMode, {
          onChunk: (chunk) => {
            set((state) => ({
              isStreaming: true,
              currentStreamingContent: state.currentStreamingContent + chunk,
            }));
          },
          onComplete: (message, conversationId) => {
            console.log("✅ Message complete, conversation_id:", conversationId);
            const previousConversationId = get().currentConversationId;
            
            set((state) => {
              const updatedMessages = [...state.messages];
              // Remove any temporary streaming message
              const filteredMessages = updatedMessages.filter(
                (msg) => msg.id !== `streaming-${conversationId}`
              );
              
              // Add the complete assistant message
              // CRITICAL: Store conversation_id from response for subsequent requests
              return {
                messages: [...filteredMessages, message],
                currentConversationId: conversationId, // Store conversation_id for next request
                isLoading: false,
                isStreaming: false,
                currentStreamingContent: "",
              };
            });

            // If this is a new conversation (no previous conversation_id), add it to the conversation list
            if (!previousConversationId && conversationId) {
              const conversationStore = useConversationStore.getState();
              // Check if conversation already exists in the list
              const exists = conversationStore.conversations.some(
                (conv) => conv.conversation_id === conversationId
              );
              if (!exists) {
                // Add new conversation optimistically so it appears immediately in sidebar
                conversationStore.addConversation({
                  conversation_id: conversationId,
                  title: null, // Title will be generated/updated by backend
                  last_message_at: new Date().toISOString(),
                });
                console.log("➕ Added new conversation to list:", conversationId);
                // Fetch again after delay to pick up server-generated title
                setTimeout(() => {
                  useConversationStore.getState().fetchConversations();
                }, 3000);
              }
            }
          },
          onError: (error) => {
            const errorMessage = error.message;
            console.error("❌ Chat New Error:", errorMessage);

            // Add error as a persistent message
            const errorMsg: Message = {
              id: `error-${Date.now()}`,
              conversation_id: "",
              role: "assistant",
              content: errorMessage,
              created_at: new Date().toISOString(),
              metadata: { isError: true }
            };

            set((state) => ({
              messages: [...state.messages, errorMsg],
              error: errorMessage,
              isLoading: false,
              isStreaming: false,
              currentStreamingContent: "",
            }));
          },
        });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Failed to send message";
      console.error("❌ sendMessage Catch Error:", errorMessage);

      // Add error as a persistent message
      const errorMsg: Message = {
        id: `error-catch-${Date.now()}`,
        conversation_id: get().currentConversationId || "",
        role: "assistant",
        content: errorMessage,
        created_at: new Date().toISOString(),
        metadata: { isError: true }
      };

      set((state) => ({
        messages: [...state.messages, errorMsg],
        error: errorMessage,
        isLoading: false,
        isStreaming: false,
        currentStreamingContent: "",
      }));
    }
  },

  addMessage: (message: Message) => {
    set((state) => ({
      messages: [...state.messages, message],
    }));
  },

  setConversationId: (id: string) => {
    const currentId = get().currentConversationId;
    // CRITICAL: If switching to a different conversation, IMMEDIATELY clear all state
    // This must happen synchronously before any async operations
    if (id !== currentId) {
      console.log("🔄 setConversationId: Clearing state for switch", { from: currentId, to: id });
      set({ 
        currentConversationId: id,
        messages: [], // IMMEDIATELY clear messages
        isStreaming: false,
        currentStreamingContent: "",
        isLoading: false, // Reset loading state
        error: null, // Clear any errors
      });
    } else {
      // Same conversation, just update ID (shouldn't happen often)
      set({ currentConversationId: id });
    }
  },

  clearChat: () => {
    console.log("🧹 clearChat: Resetting all chat state");
    set({
      currentConversationId: null,
      messages: [],
      isLoading: false,
      isStreaming: false,
      error: null,
      currentStreamingContent: "",
    });
  },

  loadConversation: async (id: string) => {
    console.log("📥 loadConversation called with id:", id);
    const currentId = get().currentConversationId;
    
    // CRITICAL: Ensure we're loading the correct conversation
    // If ID doesn't match, something went wrong - clear and set it
    if (id !== currentId) {
      console.log("⚠️ ID mismatch in loadConversation, correcting:", { expected: id, current: currentId });
      set({ 
        messages: [], 
        currentConversationId: id,
        isStreaming: false,
        currentStreamingContent: "",
      });
    }
    
    // Set loading state (messages should already be cleared by setConversationId)
    set({ 
      isLoading: true, 
      error: null,
    });
    try {
      console.log("Fetching messages for conversation:", id);
      const conversation = await getConversationMessages(id);
      console.log("API response:", conversation);
      console.log("Messages in response:", conversation.messages);
      const messagesArray = conversation.messages || [];
      console.log("Setting messages, count:", messagesArray.length);
      set({
        messages: messagesArray,
        currentConversationId: id,
        isLoading: false,
      });
      console.log("State updated, messages should now be visible");
    } catch (error) {
      console.error("Failed to load conversation:", error);
      const errorMessage = error instanceof Error ? error.message : "Failed to load conversation";
      set({
        error: errorMessage,
        isLoading: false,
        messages: [],
        currentConversationId: id,
      });
    }
  },

  updateStreamingContent: (content: string) => {
    set({ currentStreamingContent: content, isStreaming: true });
  },

  finishStreaming: () => {
    set({ isStreaming: false, currentStreamingContent: "" });
  },
}));


