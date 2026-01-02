"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AskRequestSchema } from "@/lib/schemas/requests";
import { Button } from "@/components/ui/button";
import { useChatStore } from "@/store/chatStore";
import { Send, Paperclip, X } from "lucide-react";
import type { AskRequest } from "@/types";
import { cn } from "@/lib/utils";
import { useRef, useEffect, useState } from "react";
import { UploadModal } from "@/components/upload/UploadModal";

interface FilePreview {
  file: File;
  id: string;
}

export function ChatInput() {
  const { sendMessage, isLoading, isStreaming, currentConversationId } = useChatStore();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<FilePreview[]>([]);
  const prevConversationIdRef = useRef<string | null>(null);

  // Auto-focus input when starting a new conversation
  useEffect(() => {
    // If conversationId changed from something to null (new chat), focus input
    if (prevConversationIdRef.current !== null && currentConversationId === null) {
      setTimeout(() => {
        textareaRef.current?.focus();
      }, 100);
    }
    prevConversationIdRef.current = currentConversationId;
  }, [currentConversationId]);

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
    watch,
  } = useForm<AskRequest>({
    resolver: zodResolver(AskRequestSchema),
  });

  const query = watch("query");
  const isDisabled = isLoading || isStreaming;

  // Register textarea with ref
  const { ref, ...registerProps } = register("query");

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
    }
  }, [query]);

  const onSubmit = async (data: AskRequest) => {
    if (isDisabled) return;
    await sendMessage(data.query);
    reset();
    setSelectedFiles([]);
    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  };

  const handleFileSelect = (file: File) => {
    const preview: FilePreview = {
      file,
      id: `${Date.now()}-${Math.random()}`,
    };
    setSelectedFiles((prev) => [...prev, preview]);
  };

  const removeFile = (id: string) => {
    setSelectedFiles((prev) => prev.filter((f) => f.id !== id));
  };

  return (
    <>
      <div className="fixed bottom-0 left-0 right-0 z-10 bg-white dark:bg-neutral-900 border-t border-neutral-200 dark:border-neutral-800 lg:left-64">
        <div className="mx-auto max-w-4xl px-3 py-3 sm:px-4 sm:py-4 md:px-6">
          {/* File preview chips */}
          {selectedFiles.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {selectedFiles.map((preview) => (
                <div
                  key={preview.id}
                  className="flex items-center gap-2 rounded-lg bg-neutral-100 px-3 py-1.5 text-sm dark:bg-neutral-800"
                >
                  <span className="truncate max-w-[200px] text-neutral-700 dark:text-neutral-300">
                    {preview.file.name}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeFile(preview.id)}
                    className="text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <form
            onSubmit={handleSubmit(onSubmit)}
            className="flex items-end gap-2"
          >
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setUploadModalOpen(true)}
              className="h-9 w-9 shrink-0 rounded-lg sm:h-10 sm:w-10"
              disabled={isDisabled}
            >
              <Paperclip className="h-4 w-4 sm:h-5 sm:w-5" />
            </Button>
            <div className="relative flex-1">
              <textarea
                {...registerProps}
                ref={(e) => {
                  ref(e);
                  textareaRef.current = e;
                }}
                placeholder="Ask about Ga language..."
                disabled={isDisabled}
                rows={1}
                className={cn(
                  "w-full resize-none rounded-2xl border border-neutral-200 bg-white px-3 py-2.5 pr-10 text-sm",
                  "placeholder:text-neutral-400",
                  "focus:outline-none focus:ring-2 focus:ring-neutral-400 focus:ring-offset-0",
                  "disabled:cursor-not-allowed disabled:opacity-50",
                  "dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100",
                  "dark:placeholder:text-neutral-500",
                  "dark:focus:ring-neutral-600",
                  "transition-all",
                  "sm:px-4 sm:py-3 sm:pr-12"
                )}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (!isDisabled) {
                      handleSubmit(onSubmit)();
                    }
                  }
                }}
              />
              <Button
                type="submit"
                disabled={isDisabled}
                size="icon"
                className={cn(
                  "absolute bottom-1.5 right-1.5 h-7 w-7 rounded-lg",
                  "bg-neutral-900 text-white hover:bg-neutral-800",
                  "disabled:opacity-50 disabled:cursor-not-allowed",
                  "dark:bg-neutral-700 dark:hover:bg-neutral-600",
                  "transition-opacity",
                  "sm:bottom-2 sm:right-2 sm:h-8 sm:w-8"
                )}
              >
                <Send className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              </Button>
            </div>
          </form>
          {errors.query && (
            <p className="mt-1 text-xs text-destructive">
              {errors.query.message}
            </p>
          )}
        </div>
      </div>
      <UploadModal
        open={uploadModalOpen}
        onOpenChange={setUploadModalOpen}
        onFileSelect={handleFileSelect}
      />
    </>
  );
}


