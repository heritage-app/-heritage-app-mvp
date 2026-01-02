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
      <div className="fixed bottom-0 left-0 right-0 z-10 bg-white/80 backdrop-blur-md dark:bg-neutral-900/80 border-t border-neutral-200/50 dark:border-neutral-800/50">
        <div className="mx-auto max-w-4xl px-4 py-4 sm:px-6 sm:py-5 md:px-8">
          {/* File preview chips */}
          {selectedFiles.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-2">
              {selectedFiles.map((preview) => (
                <div
                  key={preview.id}
                  className="flex items-center gap-2 rounded-full bg-neutral-100 px-3 py-1.5 text-xs shadow-sm dark:bg-neutral-800"
                >
                  <span className="truncate max-w-[200px] text-neutral-700 dark:text-neutral-300">
                    {preview.file.name}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeFile(preview.id)}
                    className="text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200 transition-colors"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <form
            onSubmit={handleSubmit(onSubmit)}
            className="relative flex items-end gap-2"
          >
            <div className="relative flex-1 rounded-2xl border border-neutral-200 bg-white shadow-sm transition-all focus-within:border-neutral-400 focus-within:shadow-md dark:border-neutral-700 dark:bg-neutral-800 dark:focus-within:border-neutral-600">
              <textarea
                {...registerProps}
                ref={(e) => {
                  ref(e);
                  textareaRef.current = e;
                }}
                placeholder="Message Heritage App..."
                disabled={isDisabled}
                rows={1}
                className={cn(
                  "w-full resize-none rounded-2xl bg-transparent px-4 py-3 pr-20 text-sm leading-6",
                  "placeholder:text-neutral-400",
                  "focus:outline-none",
                  "disabled:cursor-not-allowed disabled:opacity-50",
                  "dark:text-neutral-100",
                  "dark:placeholder:text-neutral-500",
                  "transition-all",
                  "sm:px-5 sm:py-3.5 sm:pr-24"
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
              <div className="absolute bottom-2 right-2 flex items-center gap-1 sm:bottom-2.5 sm:right-2.5">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setUploadModalOpen(true)}
                  className="h-8 w-8 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-700 sm:h-9 sm:w-9"
                  disabled={isDisabled}
                >
                  <Paperclip className="h-4 w-4 text-neutral-500 dark:text-neutral-400" />
                </Button>
                <Button
                  type="submit"
                  disabled={isDisabled}
                  size="icon"
                  className={cn(
                    "h-8 w-8 rounded-lg shadow-sm transition-all",
                    "bg-neutral-900 text-white hover:bg-neutral-800 hover:shadow-md",
                    "disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:shadow-sm",
                    "dark:bg-neutral-700 dark:hover:bg-neutral-600",
                    "sm:h-9 sm:w-9"
                  )}
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </form>
          {errors.query && (
            <p className="mt-2 text-xs text-red-600 dark:text-red-400 px-1">
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


