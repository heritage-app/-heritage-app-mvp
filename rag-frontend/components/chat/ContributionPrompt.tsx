"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { BookOpen, Lightbulb, Send, X, Heart } from "lucide-react";

interface ContributionPromptProps {
  query: string;
  isVisible: boolean;
  onClose: () => void;
  onSubmit: (answer: string) => void;
  category: 'bible' | 'cultural' | 'translation' | 'general';
}

export function ContributionPrompt({ 
  query, 
  isVisible, 
  onClose, 
  onSubmit,
  category 
}: ContributionPromptProps) {
  const [userAnswer, setUserAnswer] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!userAnswer.trim()) return;
    
    setIsSubmitting(true);
    try {
      await onSubmit(userAnswer);
      setUserAnswer("");
      onClose();
    } catch (error) {
      console.error("Failed to submit contribution:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isVisible) return null;

  const categoryIcons = {
    bible: BookOpen,
    cultural: Lightbulb,
    translation: BookOpen,
    general: Lightbulb,
  };

  const CategoryIcon = categoryIcons[category];

  const placeholderText = category === 'cultural' || category === 'translation'
    ? `What does "${query}" mean in Ga? When do you use it?`
    : `Share what you know about "${query}"...`;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-background/95 backdrop-blur-xl border border-primary/20 rounded-2xl shadow-2xl max-w-lg w-full">
        {/* Header */}
        <div className="px-6 py-4 border-b border-primary/10">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-primary/20 rounded-full">
                <Heart className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h3 className="font-semibold text-foreground">Teach Me!</h3>
                <p className="text-xs text-foreground/60">Help me learn about Ga language</p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="h-8 w-8 text-foreground/40 hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Content */}
        <div className="px-6 py-4 space-y-4">
          <div className="bg-primary/5 border border-primary/10 rounded-lg p-3">
            <p className="text-xs text-foreground/60 mb-1">You asked about:</p>
            <p className="text-sm font-medium text-foreground">"{query}"</p>
          </div>

          <div className="bg-primary/5 border border-primary/10 rounded-lg p-3">
            <p className="text-xs text-foreground/60 mb-2">
              <Heart className="h-3 w-3 inline mr-1" />
              I'd love to learn from you!
            </p>
            <p className="text-xs text-foreground/80">
              Your knowledge will help preserve Ga language and culture for others to learn from too.
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground/90">
              What can you teach me about this?
            </label>
            <Textarea
              value={userAnswer}
              onChange={(e) => setUserAnswer(e.target.value)}
              placeholder={placeholderText}
              className="min-h-[120px] resize-none"
              disabled={isSubmitting}
            />
            <p className="text-xs text-foreground/50">
              You can write in Ga, English, or both. I'll learn from whatever you share!
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-primary/10 flex justify-end gap-3">
          <Button
            variant="ghost"
            onClick={onClose}
            disabled={isSubmitting}
            className="text-foreground/60"
          >
            Maybe Later
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!userAnswer.trim() || isSubmitting}
            className="gap-2"
          >
            {isSubmitting ? (
              "Teaching Me..."
            ) : (
              <>
                <Send className="h-4 w-4" />
                Teach Me
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}