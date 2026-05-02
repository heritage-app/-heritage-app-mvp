"use client";

import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AskRequestSchema } from "@/lib/schemas/requests";
import { Button } from "@/components/ui/button";
import { useChatStore } from "@/store/chatStore";
import { useMessages } from "@/hooks/use-messages";
import { Send, X, CirclePlus, Mic, Eye } from "lucide-react";
import type { AskRequest } from "@/types";
import { cn } from "@/lib/utils";
import { useRef, useEffect, useState } from "react";
import { UploadModal } from "@/components/upload/UploadModal";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDown, Sparkles, Brain, Book, History, Wand2 } from "lucide-react";

interface FilePreview {
  file: File;
  id: string;
}

interface ChatInputProps {
  className?: string;
  containerClassName?: string;
  inputClassName?: string;
  isStatic?: boolean;
  variant?: "hero" | "compact";
}

export function ChatInput({ 
  className, 
  containerClassName, 
  inputClassName,
  isStatic = false,
  variant = "hero"
}: ChatInputProps) {
  const { isLoading, isStreaming, currentConversationId, selectedMode, setMode } = useChatStore();
  const { sendMessage } = useMessages(currentConversationId);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<FilePreview[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>("gemini-3-flash-preview");
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
    setValue,
    formState: { errors },
    reset,
    watch,
  } = useForm<z.input<typeof AskRequestSchema>, any, AskRequest>({
    resolver: zodResolver(AskRequestSchema),
    mode: "onChange",
  });

  const query = watch("query");
  const isDisabled = isLoading || isStreaming;

  // Register textarea with ref
  const { ref, ...registerProps } = register("query");

  // Auto-resize textarea
  const updateHeight = () => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
    }
  };

  useEffect(() => {
    updateHeight();
  }, [query]);

  const handlePaste = () => {
    // Small delay to ensure the paste operation is processed by the browser
    setTimeout(updateHeight, 0);
  };

  const onSubmit = async (data: AskRequest) => {
    if (isDisabled) return;
    
    const submittedQuery = data.query;
    
    // 1. CLEAR IMMEDIATELY for better UX
    reset();
    setSelectedFiles([]);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }

    // 2. TRIGGER SEND (don't await for the whole streaming process)
    sendMessage({ query: submittedQuery, model: selectedModel });
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
      <div className={cn(
        isStatic ? "relative inline-block w-full" : "fixed bottom-4 sm:bottom-12 left-0 right-0 z-50 pointer-events-none pb-safe",
        containerClassName
      )}>
        <div className={cn(
          "mx-auto max-w-4xl px-3 sm:px-6 md:px-8",
          !isStatic && "pointer-events-auto flex justify-center",
          className
        )}>
          {/* File preview chips - Compact Style */}
          {selectedFiles.length > 0 && (
            <div className="mb-4 flex flex-wrap gap-2 px-2 overflow-x-auto pb-1 scrollbar-hide">
              {selectedFiles.map((preview) => (
                <div
                  key={preview.id}
                  className="flex items-center gap-2 rounded-xl bg-background/60 backdrop-blur-xl border border-primary/20 px-3 py-1.5 text-[0.6rem] font-mono font-bold text-foreground/70 shrink-0"
                >
                  <span className="truncate max-w-[120px] sm:max-w-[150px] uppercase">{preview.file.name}</span>
                  <button type="button" onClick={() => removeFile(preview.id)} className="text-primary hover:text-white transition-colors p-1">
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <form onSubmit={handleSubmit(onSubmit)} className={cn(
            "relative group w-full",
            variant === "hero" ? "max-w-3xl" : "max-w-full"
          )}>
            <div className={cn(
              "relative flex flex-col transition-all duration-500",
              variant === "hero" 
                ? "rounded-[1.5rem] sm:rounded-[2rem] border border-primary/30 bg-background/60 backdrop-blur-3xl p-1 sm:p-1.5 focus-within:border-primary/60 focus-within:bg-background/90"
                : "rounded-xl sm:rounded-2xl border border-primary/20 bg-background/40 backdrop-blur-xl p-0.5 sm:p-1 focus-within:border-primary/50 focus-within:bg-background/80",
              containerClassName
            )}>
              {/* TOP ROW: Input */}
              <div className={cn(
                "flex items-center gap-2",
                variant === "hero" ? "pt-2 sm:pt-4 px-3 sm:px-4" : "pt-1.5 sm:pt-2 px-2 sm:px-3"
              )}>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className={cn(
                    "shrink-0 rounded-full text-foreground/20 hover:text-foreground/40 hover:bg-black/5",
                    variant === "hero" ? "h-9 w-9 sm:h-10 w-10" : "h-7 w-7 sm:h-8 w-8"
                  )}
                >
                  <CirclePlus className={cn(variant === "hero" ? "h-4.5 w-4.5 sm:h-5 w-5" : "h-3.5 w-3.5 sm:h-4 w-4")} />
                </Button>
                <div className="flex-1">
                  <textarea
                    {...registerProps}
                    ref={(e) => {
                      ref(e);
                      textareaRef.current = e;
                    }}
                    placeholder="Ask the Linguistic Engine..."
                    disabled={isDisabled}
                    rows={1}
                    onPaste={handlePaste}
                    className={cn(
                      "w-full resize-none bg-transparent py-1.5 transition-all scrollbar-hide",
                      variant === "hero" 
                        ? "text-[16px] leading-6 min-h-[1.5rem]" 
                        : "text-[15px] leading-5 min-h-[1.25rem]",
                      "placeholder:text-foreground/40 placeholder:font-medium",
                      "focus:outline-none text-foreground/90 font-medium tracking-tight",
                      inputClassName
                    )}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        if (window.innerWidth > 768) {
                          e.preventDefault();
                          if (!isDisabled && query?.trim()) {
                            handleSubmit(onSubmit)();
                          }
                        }
                      }
                    }}
                  />
                </div>
              </div>

              {/* BOTTOM ROW: Command Bar */}
              <div className={cn(
                "flex items-center justify-between px-2 pb-1.5 sm:pb-2",
                variant === "hero" ? "pt-2 sm:pt-4" : "pt-0.5 sm:pt-1"
              )}>
                <div className="flex items-center gap-1.5 ml-2">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button 
                        type="button" 
                        variant="ghost" 
                        size="sm" 
                        className="h-7 gap-1.5 rounded-full px-2.5 text-[0.6rem] font-bold uppercase tracking-widest text-foreground/40 hover:bg-white/5 hover:text-foreground/60 transition-all"
                      >
                        {selectedModel.includes("gemini") ? (
                          <Sparkles className="h-3 w-3 text-primary/60" />
                        ) : selectedModel.includes("nemotron") ? (
                          <Eye className="h-3 w-3 text-emerald-400/60" />
                        ) : (
                          <Brain className="h-3 w-3 text-blue-400/60" />
                        )}
                        <span className="hidden sm:inline">
                          {selectedModel.includes("gemini") 
                            ? "Linguistic Engine" 
                            : selectedModel.includes("nemotron") 
                              ? "Vision Engine" 
                              : "Logic Engine"}
                        </span>
                        <ChevronDown className="h-2.5 w-2.5 opacity-50 shrink-0" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-56 rounded-2xl border-primary/20 bg-background/80 backdrop-blur-2xl p-1.5">
                      <DropdownMenuItem 
                        onClick={() => setSelectedModel("gemini-3-flash-preview")}
                        className="flex flex-col items-start gap-1 rounded-xl p-2.5 focus:bg-primary/10"
                      >
                        <div className="flex items-center gap-2 font-bold uppercase tracking-tighter text-[0.65rem]">
                          <Sparkles className="h-3 w-3 text-primary" />
                          Linguistic Engine (Gemini 3 Flash)
                        </div>
                        <div className="text-[10px] lowercase text-foreground/40 font-medium">Ultra-efficient 3rd gen. processing (Preview).</div>
                      </DropdownMenuItem>
                      <DropdownMenuItem 
                        onClick={() => setSelectedModel("gemini-3.1-pro-preview")}
                        className="flex flex-col items-start gap-1 rounded-xl p-2.5 focus:bg-primary/10"
                      >
                        <div className="flex items-center gap-2 font-bold uppercase tracking-tighter text-[0.65rem]">
                          <Sparkles className="h-3 w-3 text-amber-400" />
                          Linguistic Engine (Gemini 3.1 Pro)
                        </div>
                        <div className="text-[10px] lowercase text-foreground/40 font-medium">Deep archival grounding with 3.1 Pro logic.</div>
                      </DropdownMenuItem>
                      <DropdownMenuItem 
                        onClick={() => setSelectedModel("gemini-3.1-flash-lite-preview")}
                        className="flex flex-col items-start gap-1 rounded-xl p-2.5 focus:bg-primary/10"
                      >
                        <div className="flex items-center gap-2 font-bold uppercase tracking-tighter text-[0.65rem]">
                          <Sparkles className="h-3 w-3 text-emerald-400" />
                          Linguistic Engine (Gemini 3.1 Lite)
                        </div>
                        <div className="text-[10px] lowercase text-foreground/40 font-medium">High-speed linguistic analysis (Preview).</div>
                      </DropdownMenuItem>
                      <DropdownMenuItem 
                        onClick={() => setSelectedModel("meta-llama/llama-3-8b-instruct")}
                        className="flex flex-col items-start gap-1 rounded-xl p-2.5 focus:bg-blue-500/10"
                      >
                        <div className="flex items-center gap-2 font-bold uppercase tracking-tighter text-[0.65rem]">
                          <Brain className="h-3 w-3 text-blue-400" />
                          Logic Engine (Llama 3)
                        </div>
                        <div className="text-[10px] lowercase text-foreground/40 font-medium">Enhanced logical reasoning & cross-referencing.</div>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>

                  {/* RAG FOCUS SELECTOR */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button 
                        type="button" 
                        variant="ghost" 
                        size="sm" 
                        className="h-7 gap-1.5 rounded-full px-2.5 text-[0.6rem] font-bold uppercase tracking-widest text-foreground/40 hover:bg-white/5 hover:text-foreground/60 transition-all border border-primary/5 bg-background/20"
                      >
                        {selectedMode === "auto" ? (
                          <Wand2 className="h-3 w-3 text-primary/60" />
                        ) : selectedMode === "bible" ? (
                          <Book className="h-3 w-3 text-amber-400/60" />
                        ) : (
                          <History className="h-3 w-3 text-emerald-400/60" />
                        )}
                        <span className="opacity-70 hidden sm:inline">Focus:</span>
                        <span className="hidden sm:inline">
                          {selectedMode === "auto" 
                            ? "Auto" 
                            : selectedMode === "bible" 
                              ? "Bible" 
                              : "General"}
                        </span>
                        <ChevronDown className="h-2.5 w-2.5 opacity-50 shrink-0" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-56 rounded-2xl border-primary/20 bg-background/80 backdrop-blur-2xl p-1.5">
                      <DropdownMenuItem 
                        onClick={() => setMode("auto")}
                        className="flex flex-col items-start gap-1 rounded-xl p-2.5 focus:bg-primary/10"
                      >
                        <div className="flex items-center gap-2 font-bold uppercase tracking-tighter text-[0.65rem]">
                          <Wand2 className="h-3 w-3 text-primary" />
                          Auto (Intelligent Routing)
                        </div>
                        <div className="text-[10px] lowercase text-foreground/40 font-medium">Smart detection for verses or general history.</div>
                      </DropdownMenuItem>
                      <DropdownMenuItem 
                        onClick={() => setMode("bible")}
                        className="flex flex-col items-start gap-1 rounded-xl p-2.5 focus:bg-amber-500/10"
                      >
                        <div className="flex items-center gap-2 font-bold uppercase tracking-tighter text-[0.65rem]">
                          <Book className="h-3 w-3 text-amber-400" />
                          Bible Archives
                        </div>
                        <div className="text-[10px] lowercase text-foreground/40 font-medium">Strict archival fidelity for Ga spiritual texts.</div>
                      </DropdownMenuItem>
                      <DropdownMenuItem 
                        onClick={() => setMode("general")}
                        className="flex flex-col items-start gap-1 rounded-xl p-2.5 focus:bg-emerald-500/10"
                      >
                        <div className="flex items-center gap-2 font-bold uppercase tracking-tighter text-[0.65rem]">
                          <History className="h-3 w-3 text-emerald-400" />
                          Cultural Wisdom
                        </div>
                        <div className="text-[10px] lowercase text-foreground/40 font-medium">Focus on Ga history, stories, and traditions.</div>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                <div className="flex items-center gap-1.5 sm:gap-3 pr-1">
                  <div className={cn(
                    "font-mono font-bold uppercase tracking-widest tabular-nums",
                    variant === "hero" ? "text-[0.6rem] sm:text-[0.65rem] text-foreground/50" : "text-[0.55rem] sm:text-[0.6rem] text-foreground/30"
                  )}>
                    {query?.length || 0}/2000
                  </div>
                  <Button
                    type="submit"
                    disabled={isDisabled || !query?.trim()}
                    size="icon"
                    className={cn(
                      "rounded-full transition-all duration-500",
                      variant === "hero" ? "h-10 w-10" : "h-8 w-8",
                      "bg-primary text-background hover:scale-110 active:scale-90",
                      "disabled:opacity-10 disabled:grayscale disabled:scale-100 disabled:cursor-not-allowed"
                    )}
                  >
                    <Send className={cn(variant === "hero" ? "h-4 w-4" : "h-3 w-3")} />
                  </Button>
                </div>
              </div>
            </div>
          </form>
          {errors.query && (
            <p className="mt-4 text-[0.6rem] font-mono font-bold uppercase tracking-widest text-red-500/60 px-6">
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


