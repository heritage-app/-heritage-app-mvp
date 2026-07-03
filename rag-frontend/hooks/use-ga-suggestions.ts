"use client";

import { useState, useCallback } from "react";
import { getGaSuggestions, type GaSuggestion } from "@/lib/data/ga-vocabulary";

interface AISuggestion {
  text: string;
  phonetic?: string;
  english?: string;
  context?: string;
  confidence: number;
}

export function useGaSuggestions() {
  const [aiSuggestions, setAiSuggestions] = useState<AISuggestion[]>([]);
  const [isLoadingAI, setIsLoadingAI] = useState(false);

  /**
   * Get hybrid suggestions: static vocabulary + AI-powered suggestions
   */
  const getSuggestions = useCallback(async (input: string, conversationContext?: string) => {
    if (!input || input.length < 1) {
      return [];
    }

    // 1. Get static vocabulary suggestions
    const staticSuggestions = getGaSuggestions(input, 5);

    // 2. If input is substantial, try to get AI-powered suggestions
    if (input.length >= 2 && conversationContext) {
      try {
        setIsLoadingAI(true);
        const aiResults = await fetchAISuggestions(input, conversationContext);
        setAiSuggestions(aiResults);
        
        // Combine static and AI suggestions, prioritizing AI ones
        const combined = [
          ...aiResults.map(ai => ({
            text: ai.text,
            type: 'phrase' as const,
            phonetic: ai.phonetic,
            description: ai.context,
            english: ai.english,
          })),
          ...staticSuggestions
        ].slice(0, 8); // Limit to 8 total suggestions

        return combined;
      } catch (error) {
        console.error('AI suggestions failed, falling back to static:', error);
        return staticSuggestions;
      } finally {
        setIsLoadingAI(false);
      }
    }

    return staticSuggestions;
  }, []);

  return {
    getSuggestions,
    aiSuggestions,
    isLoadingAI,
  };
}

/**
 * Call the backend AI to generate contextually relevant Ga suggestions
 */
async function fetchAISuggestions(input: string, context: string): Promise<AISuggestion[]> {
  try {
    const response = await fetch('/api/suggestions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        input,
        context,
        language: 'ga',
      }),
    });

    if (!response.ok) {
      throw new Error('Failed to fetch AI suggestions');
    }

    const data = await response.json();
    return data.suggestions || [];
  } catch (error) {
    console.error('Error fetching AI suggestions:', error);
    return [];
  }
}