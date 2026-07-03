"use client";

import { useEffect, useState, useRef } from "react";
import { getGaSuggestions, type GaSuggestion } from "@/lib/data/ga-vocabulary";
import { cn } from "@/lib/utils";
import { ChevronRight, Book, Hash, MessageSquare, Globe, Volume2, Sparkles } from "lucide-react";

interface GaAutocompleteProps {
  input: string;
  onSelect: (suggestion: string) => void;
  isVisible: boolean;
  onClose: () => void;
  conversationContext?: string;
}

const TYPE_ICONS = {
  number: Hash,
  bible: Book,
  phrase: MessageSquare,
  greeting: Globe,
  book: Book,
};

export function GaAutocomplete({ input, onSelect, isVisible, onClose, conversationContext = "" }: GaAutocompleteProps) {
  const [suggestions, setSuggestions] = useState<GaSuggestion[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isAIPowered, setIsAIPowered] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isVisible && input.length >= 1) {
      const newSuggestions = getGaSuggestions(input, 8);
      setSuggestions(newSuggestions);
      setSelectedIndex(0);
      setIsAIPowered(false); // Will be true when AI suggestions are integrated
    } else {
      setSuggestions([]);
    }
  }, [input, isVisible]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    if (isVisible) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isVisible, onClose]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isVisible || suggestions.length === 0) return;

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % suggestions.length);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + suggestions.length) % suggestions.length);
      } else if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        onSelect(suggestions[selectedIndex].text);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isVisible, suggestions, selectedIndex, onSelect, onClose]);

  const speakPhonetic = (text: string, phonetic: string) => {
    if ('speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'gaa'; // Try to use Ga language if available
      utterance.rate = 0.8; // Slower for clarity
      speechSynthesis.speak(utterance);
    }
  };

  if (!isVisible || suggestions.length === 0) return null;

  const Icon = TYPE_ICONS[suggestions[selectedIndex]?.type] || MessageSquare;

  return (
    <div
      ref={containerRef}
      className="absolute bottom-full left-0 right-0 mb-2 z-50"
    >
      <div className="bg-background/95 backdrop-blur-xl border border-primary/20 rounded-xl shadow-2xl overflow-hidden">
        <div className="px-3 py-2 border-b border-primary/10 bg-primary/5">
          <div className="flex items-center gap-2 text-xs font-medium text-primary/60">
            {isAIPowered ? (
              <Sparkles className="h-3.5 w-3.5 text-primary" />
            ) : (
              <Icon className="h-3.5 w-3.5" />
            )}
            <span>{isAIPowered ? "AI-Powered" : "Ga"} Suggestions</span>
            <span className="text-foreground/40">•</span>
            <span className="text-foreground/40">{suggestions.length} found</span>
          </div>
        </div>
        <div className="max-h-64 overflow-y-auto">
          {suggestions.map((suggestion, index) => {
            const ItemIcon = TYPE_ICONS[suggestion.type] || MessageSquare;
            const isSelected = index === selectedIndex;
            
            return (
              <button
                key={index}
                type="button"
                onClick={() => onSelect(suggestion.text)}
                className={cn(
                  "w-full px-3 py-2.5 flex items-center gap-3 text-left transition-colors",
                  isSelected ? "bg-primary/20 text-primary" : "hover:bg-primary/10 text-foreground/80"
                )}
              >
                <ItemIcon className={cn(
                  "h-4 w-4 shrink-0",
                  isSelected ? "text-primary" : "text-foreground/40"
                )} />
                <div className="flex-1 min-w-0">
                  <div className={cn(
                    "font-medium truncate",
                    isSelected ? "text-primary" : "text-foreground/90"
                  )}>
                    {suggestion.text}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    {suggestion.phonetic && (
                      <div className="text-[10px] text-foreground/50 font-mono">
                        /{suggestion.phonetic}/
                      </div>
                    )}
                    {suggestion.english && (
                      <div className="text-[10px] text-foreground/40">
                        "{suggestion.english}"
                      </div>
                    )}
                  </div>
                  {suggestion.description && (
                    <div className="text-xs text-foreground/50 truncate mt-0.5">
                      {suggestion.description}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {suggestion.phonetic && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        speakPhonetic(suggestion.text, suggestion.phonetic!);
                      }}
                      className={cn(
                        "p-1.5 rounded-full transition-colors",
                        isSelected ? "text-primary hover:bg-primary/30" : "text-foreground/30 hover:text-foreground/60 hover:bg-black/5"
                      )}
                      title="Listen to pronunciation"
                    >
                      <Volume2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                  {isSelected && (
                    <ChevronRight className="h-4 w-4 text-primary" />
                  )}
                </div>
              </button>
            );
          })}
        </div>
        <div className="px-3 py-2 border-t border-primary/10 bg-primary/5">
          <div className="flex items-center justify-between text-[10px] text-foreground/40">
            <span>↑↓ to navigate • Enter to select</span>
            <span>Esc to close • 🔊 to hear</span>
          </div>
        </div>
      </div>
    </div>
  );
}