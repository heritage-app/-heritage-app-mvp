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
import { GaAutocomplete } from "@/components/chat/GaAutocomplete";
import { GaPhoneticsGuide, gaSoundTooltip } from "@/components/chat/GaPhoneticsGuide";
import { useGaSuggestions } from "@/hooks/use-ga-suggestions";
import { transcribeGaKey, wordAtEnd, type GaKeyConversion } from "@/lib/ga/transliterate";
import { foldGa } from "@/lib/data/ga-vocabulary";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDown, Sparkles, Brain, Book, History, Wand2, Globe } from "lucide-react";

interface FilePreview {
  file: File;
  id: string;
}

// Ga orthography helpers, per the Bureau of Ghana Languages guide:
// letters missing from standard keyboards (incl. the nasal ã as in "fã"),
// then the digraphs/trigraphs (gb, kp, ts, sh, ŋm, ŋw, shw, tsw, ...).
const GA_LETTERS = ["ɛ", "ɔ", "ŋ", "ã", "Ɛ", "Ɔ", "Ŋ"];
const GA_DIGRAPHS = ["gb", "kp", "ts", "sh", "ny", "kw", "gw", "hw", "jw", "ŋm", "ŋw", "shw", "tsw"];

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
  const { isLoading, isStreaming, currentConversationId, selectedMode, setMode, messages } = useChatStore();
  const { sendMessage } = useMessages(currentConversationId);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<FilePreview[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>("@cf/meta/llama-3.3-70b-instruct-fp8-fast");
  const [inputLanguage, setInputLanguage] = useState<"gaa" | "en">("gaa");
  const [showAutocomplete, setShowAutocomplete] = useState(false);
  const [phoneticsOpen, setPhoneticsOpen] = useState(false);
  const prevConversationIdRef = useRef<string | null>(null);
  // Last ASCII→Ga transliteration, kept so a Backspace right after it can
  // restore the literal keystrokes (standard IME undo).
  const translitUndoRef = useRef<GaKeyConversion | null>(null);
  const [caretAtEnd, setCaretAtEnd] = useState(true);
  const [ghostDismissed, setGhostDismissed] = useState(false);

  // Declared before any effect that lists `query` in its deps (TDZ crash otherwise).
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

  // Refocus input when language changes to trigger keyboard switch
  useEffect(() => {
    if (textareaRef.current && document.activeElement === textareaRef.current) {
      // Blur and refocus to trigger keyboard language change
      textareaRef.current.blur();
      setTimeout(() => {
        textareaRef.current?.focus();
      }, 50);
    }
  }, [inputLanguage]);

  // Build conversation context for AI suggestions
  const conversationContext = messages
    .slice(-3) // Last 3 messages for context
    .map(m => `${m.role}: ${m.content}`)
    .join('\n');

  // Inline ghost completion replaced the always-on popup: the suggestion list
  // now opens only on demand (ArrowDown), and closes when leaving Ga mode.
  useEffect(() => {
    if (inputLanguage !== "gaa") setShowAutocomplete(false);
  }, [inputLanguage]);

  // ASCII→Ga keyboard transliteration (Ga mode only). React's synthetic
  // onBeforeInput is unreliable for `insertText`, so we bind natively.
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta || inputLanguage !== "gaa") return;
    const handler = (e: InputEvent) => {
      if (e.inputType !== "insertText" || !e.data || e.data.length !== 1) return;
      const conv = transcribeGaKey(ta.value, ta.selectionStart ?? 0, ta.selectionEnd ?? 0, e.data);
      if (!conv) return;
      e.preventDefault();
      const next = ta.value.slice(0, conv.start) + conv.insert + ta.value.slice(conv.end);
      setValue("query", next, { shouldValidate: true, shouldDirty: true });
      const caret = conv.start + conv.insert.length;
      requestAnimationFrame(() => ta.setSelectionRange(caret, caret));
      translitUndoRef.current = conv;
    };
    ta.addEventListener("beforeinput", handler);
    return () => ta.removeEventListener("beforeinput", handler);
  }, [inputLanguage, setValue]);

  // Track whether the caret sits at the end of the input — ghost text is
  // end-of-input only (mid-text completion would need caret mirroring).
  const syncCaret = () => {
    const ta = textareaRef.current;
    setCaretAtEnd(!!ta && ta.selectionStart === ta.value.length && ta.selectionEnd === ta.value.length);
  };

  // The trailing Ga word drives both the ghost suffix and the on-demand list.
  const tailWord = (query ?? "").match(/[\p{L}\p{M}]+$/u)?.[0] ?? "";
  const { suggestions, getSuggestions } = useGaSuggestions();

  useEffect(() => {
    setGhostDismissed(false);
    getSuggestions(inputLanguage === "gaa" ? tailWord : "", conversationContext);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tailWord, inputLanguage]);

  const ghostWord = inputLanguage === "gaa" && caretAtEnd && !ghostDismissed ? tailWord : "";
  const ghostSuggestion = ghostWord.length >= 1
    ? suggestions.find(
        (s) => foldGa(s.text).startsWith(foldGa(ghostWord)) && s.text.length > ghostWord.length
      )
    : undefined;
  const ghostSuffix = ghostSuggestion ? ghostSuggestion.text.slice(ghostWord.length) : "";

  const acceptGhost = () => {
    if (!ghostSuggestion) return;
    const v = query ?? "";
    const w = wordAtEnd(v, v.length);
    if (!w) return;
    setValue("query", v.slice(0, w.start) + ghostSuggestion.text, {
      shouldValidate: true,
      shouldDirty: true,
    });
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (ta) {
        ta.focus();
        ta.setSelectionRange(ta.value.length, ta.value.length);
      }
    });
  };

  const handleSuggestionSelect = (suggestion: string) => {
    const v = query ?? "";
    const w = wordAtEnd(v, v.length);
    const next = w ? v.slice(0, w.start) + suggestion : suggestion;
    setValue("query", next, { shouldValidate: true, shouldDirty: true });
    setShowAutocomplete(false);
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (ta) {
        ta.focus();
        ta.setSelectionRange(ta.value.length, ta.value.length);
      }
    });
  };

  // Insert a Ga character (ɛ, ɔ, ŋ) at the caret — standard phone keyboards
  // don't have these letters, so we offer them as tap targets in Ga mode.
  const insertGaChar = (ch: string) => {
    const ta = textareaRef.current;
    const current = query ?? "";
    const start = ta?.selectionStart ?? current.length;
    const end = ta?.selectionEnd ?? current.length;
    const next = current.slice(0, start) + ch + current.slice(end);
    setValue("query", next, { shouldValidate: true, shouldDirty: true });
    requestAnimationFrame(() => {
      if (ta) {
        ta.focus();
        ta.setSelectionRange(start + ch.length, start + ch.length);
      }
    });
  };

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
                <div className="flex-1 relative">
                  {/* Ghost-text mirror: invisible copy of the textarea content
                      plus the faint completion suffix, aligned by matching
                      the textarea's metrics. */}
                  <div
                    aria-hidden="true"
                    className={cn(
                      "pointer-events-none absolute inset-0 w-full overflow-hidden whitespace-pre-wrap break-words py-1.5 text-transparent font-medium tracking-tight",
                      variant === "hero" ? "text-[16px] leading-6" : "text-[15px] leading-5"
                    )}
                  >
                    {query ?? ""}
                    <span className="text-foreground/40">{ghostSuffix}</span>
                  </div>
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
                    onSelect={syncCaret}
                    onClick={syncCaret}
                    onKeyUp={syncCaret}
                    lang={inputLanguage}
                    inputMode="text"
                    autoCapitalize="sentences"
                    autoComplete="off"
                    autoCorrect={inputLanguage === "gaa" ? "off" : "on"}
                    spellCheck={inputLanguage !== "gaa"}
                    className={cn(
                      "relative w-full resize-none bg-transparent py-1.5 transition-all scrollbar-hide",
                      variant === "hero" 
                        ? "text-[16px] leading-6 min-h-[1.5rem]" 
                        : "text-[15px] leading-5 min-h-[1.25rem]",
                      "placeholder:text-foreground/40 placeholder:font-medium",
                      "focus:outline-none text-foreground/90 font-medium tracking-tight",
                      inputClassName
                    )}
                    onKeyDown={(e) => {
                      // Backspace right after a transliteration restores the
                      // literal keystrokes (e.g. "pɔ" back to "p)").
                      const undo = translitUndoRef.current;
                      if (e.key === "Backspace") {
                        translitUndoRef.current = null;
                        const ta = textareaRef.current;
                        if (
                          undo && ta &&
                          ta.selectionStart === ta.selectionEnd &&
                          ta.selectionStart === undo.start + undo.insert.length
                        ) {
                          e.preventDefault();
                          const v = ta.value;
                          setValue("query", v.slice(0, undo.start) + undo.typed + v.slice(undo.start + undo.insert.length), { shouldValidate: true, shouldDirty: true });
                          const c = undo.start + undo.typed.length;
                          requestAnimationFrame(() => ta.setSelectionRange(c, c));
                          return;
                        }
                      } else {
                        translitUndoRef.current = null;
                      }

                      // The suggestion list owns the keyboard while visible.
                      if (showAutocomplete) return;

                      if (ghostSuffix) {
                        if (e.key === "Tab" || (e.key === "ArrowRight" && caretAtEnd)) {
                          e.preventDefault();
                          acceptGhost();
                          return;
                        }
                        if (e.key === "Escape") {
                          e.preventDefault();
                          setGhostDismissed(true);
                          return;
                        }
                      }
                      if (e.key === "ArrowDown" && inputLanguage === "gaa" && suggestions.length > 0) {
                        e.preventDefault();
                        setShowAutocomplete(true);
                        return;
                      }
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
                  <GaAutocomplete
                    input={tailWord || query || ""}
                    onSelect={handleSuggestionSelect}
                    isVisible={showAutocomplete && inputLanguage === "gaa"}
                    onClose={() => setShowAutocomplete(false)}
                    conversationContext={conversationContext}
                  />
                </div>
              </div>

              {/* GA CHARACTER ROW: tap-to-insert letters missing from standard keyboards */}
              {inputLanguage === "gaa" && (
                <div className={cn(
                  "flex items-center gap-1.5 overflow-x-auto scrollbar-hide",
                  variant === "hero" ? "px-3 sm:px-4 pt-2" : "px-2 sm:px-3 pt-1.5"
                )}>
                  {GA_LETTERS.map((ch) => (
                    <button
                      key={ch}
                      type="button"
                      tabIndex={-1}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => insertGaChar(ch)}
                      disabled={isDisabled}
                      title={gaSoundTooltip(ch)}
                      aria-label={`Insert Ga letter ${ch}`}
                      className={cn(
                        "shrink-0 rounded-full border border-primary/20 bg-primary/5 font-semibold text-primary/80",
                        "hover:bg-primary/15 hover:text-primary active:scale-90 transition-all",
                        "disabled:opacity-30 disabled:cursor-not-allowed",
                        variant === "hero" ? "h-7 min-w-[1.75rem] px-2 text-sm" : "h-6 min-w-[1.5rem] px-1.5 text-xs"
                      )}
                    >
                      {ch}
                    </button>
                  ))}
                  <span className="shrink-0 h-4 w-px bg-primary/15 mx-0.5" aria-hidden="true" />
                  {GA_DIGRAPHS.map((ch) => (
                    <button
                      key={ch}
                      type="button"
                      tabIndex={-1}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => insertGaChar(ch)}
                      disabled={isDisabled}
                      title={gaSoundTooltip(ch)}
                      aria-label={`Insert Ga digraph ${ch}`}
                      className={cn(
                        "shrink-0 rounded-full border border-primary/10 bg-background/40 font-medium text-foreground/50",
                        "hover:bg-primary/10 hover:text-primary/80 active:scale-90 transition-all",
                        "disabled:opacity-30 disabled:cursor-not-allowed",
                        variant === "hero" ? "h-7 px-2 text-xs" : "h-6 px-1.5 text-[0.65rem]"
                      )}
                    >
                      {ch}
                    </button>
                  ))}
                  <button
                    type="button"
                    tabIndex={-1}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => setPhoneticsOpen(true)}
                    aria-label="How are Ga sounds pronounced?"
                    title="How are Ga sounds pronounced?"
                    className={cn(
                      "shrink-0 rounded-full border border-primary/10 font-mono font-bold text-foreground/40",
                      "hover:bg-primary/10 hover:text-primary/80 active:scale-90 transition-all",
                      variant === "hero" ? "h-7 min-w-[1.75rem] px-2 text-xs" : "h-6 min-w-[1.5rem] px-1.5 text-[0.65rem]"
                    )}
                  >
                    ?
                  </button>
                  <span className="ml-1 shrink-0 text-[0.55rem] font-mono font-bold tracking-widest text-foreground/30 hidden sm:inline" title="Ga typing shortcuts">
                    3=ɛ )=ɔ n~=ŋ a~=ã
                  </span>
                </div>
              )}

              {/* BOTTOM ROW: Command Bar */}
              <div className={cn(
                "flex items-center justify-between px-2 pb-1.5 sm:pb-2",
                variant === "hero" ? "pt-2 sm:pt-4" : "pt-0.5 sm:pt-1"
              )}>
                <div className="flex items-center gap-1.5 ml-2">
                  {/* Language Selector */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className={cn(
                          "shrink-0 rounded-full text-foreground/20 hover:text-foreground/40 hover:bg-black/5 transition-colors",
                          inputLanguage === "gaa" && "text-primary hover:text-primary/80 hover:bg-primary/10",
                          variant === "hero" ? "h-8 w-8 sm:h-9 w-9" : "h-6 w-6 sm:h-7 w-7"
                        )}
                        title={inputLanguage === "gaa" ? "Ga keyboard active (with autocomplete)" : "Switch Keyboard Language"}
                      >
                        <Globe className={cn(variant === "hero" ? "h-4 w-4 sm:h-4.5 w-4.5" : "h-3 w-3 sm:h-3.5 w-3.5")} />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="bg-background/95 backdrop-blur-xl border border-primary/20">
                      <DropdownMenuItem 
                        onClick={() => setInputLanguage("gaa")}
                        className={cn(
                          "cursor-pointer",
                          inputLanguage === "gaa" && "bg-primary/20 text-primary"
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <Globe className="h-4 w-4" />
                          <div className="flex flex-col">
                            <span className="font-medium">Ga (Gaa)</span>
                            <span className="text-[10px] text-foreground/50">With autocomplete</span>
                          </div>
                        </div>
                      </DropdownMenuItem>
                      <DropdownMenuItem 
                        onClick={() => setInputLanguage("en")}
                        className={cn(
                          "cursor-pointer",
                          inputLanguage === "en" && "bg-primary/20 text-primary"
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-lg">🇬🇧</span>
                          <span className="font-medium">English</span>
                        </div>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button 
                        type="button" 
                        variant="ghost" 
                        size="sm" 
                        className="h-7 gap-1.5 rounded-full px-2.5 text-[0.6rem] font-bold uppercase tracking-widest text-foreground/40 hover:bg-white/5 hover:text-foreground/60 transition-all"
                      >
                        {selectedModel.includes("70b") ? (
                          <Brain className="h-3 w-3 text-primary/60" />
                        ) : selectedModel.includes("mistral") ? (
                          <Sparkles className="h-3 w-3 text-emerald-400/60" />
                        ) : (
                          <Sparkles className="h-3 w-3 text-blue-400/60" />
                        )}
                        <span className="hidden sm:inline">
                          {selectedModel.includes("70b")
                            ? "Llama 3.3 70B"
                            : selectedModel.includes("mistral")
                              ? "Mistral 7B"
                              : "Llama 3.1 8B"}
                        </span>
                        <ChevronDown className="h-2.5 w-2.5 opacity-50 shrink-0" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-56 rounded-2xl border-primary/20 bg-background/80 backdrop-blur-2xl p-1.5">
                      <DropdownMenuItem
                        onClick={() => setSelectedModel("@cf/meta/llama-3.3-70b-instruct-fp8-fast")}
                        className="flex flex-col items-start gap-1 rounded-xl p-2.5 focus:bg-primary/10"
                      >
                        <div className="flex items-center gap-2 font-bold uppercase tracking-tighter text-[0.65rem]">
                          <Brain className="h-3 w-3 text-primary" />
                          Llama 3.3 70B
                        </div>
                        <div className="text-[10px] lowercase text-foreground/40 font-medium">Best quality — default engine.</div>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setSelectedModel("@cf/meta/llama-3.1-8b-instruct")}
                        className="flex flex-col items-start gap-1 rounded-xl p-2.5 focus:bg-primary/10"
                      >
                        <div className="flex items-center gap-2 font-bold uppercase tracking-tighter text-[0.65rem]">
                          <Sparkles className="h-3 w-3 text-blue-400" />
                          Llama 3.1 8B
                        </div>
                        <div className="text-[10px] lowercase text-foreground/40 font-medium">Faster, lighter responses.</div>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setSelectedModel("@cf/mistral/mistral-7b-instruct-v0.1")}
                        className="flex flex-col items-start gap-1 rounded-xl p-2.5 focus:bg-emerald-500/10"
                      >
                        <div className="flex items-center gap-2 font-bold uppercase tracking-tighter text-[0.65rem]">
                          <Sparkles className="h-3 w-3 text-emerald-400" />
                          Mistral 7B
                        </div>
                        <div className="text-[10px] lowercase text-foreground/40 font-medium">Alternative small model.</div>
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
      <GaPhoneticsGuide open={phoneticsOpen} onOpenChange={setPhoneticsOpen} />
    </>
  );
}


