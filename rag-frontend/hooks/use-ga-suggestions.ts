"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { getGaSuggestions, type GaSuggestion } from "@/lib/data/ga-vocabulary";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "https://heritage-backend.ekowlabs.space/api/v1";

interface BackendSuggestion {
  text: string;
  phonetic?: string;
  english?: string;
  context?: string;
  confidence: number;
  match?: string;
}

interface CacheEntry {
  data: GaSuggestion[];
  timestamp: number;
}

const CACHE_TTL_MS = 60_000; // 1 minute
const DEBOUNCE_MS = 250;
const MAX_CACHE_SIZE = 50;

const suggestionCache = new Map<string, CacheEntry>();

function cacheKey(input: string, context?: string): string {
  return context ? `${input}::${context}` : input;
}

function getFromCache(key: string): GaSuggestion[] | null {
  const entry = suggestionCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    suggestionCache.delete(key);
    return null;
  }
  return entry.data;
}

function setCache(key: string, data: GaSuggestion[]): void {
  if (suggestionCache.size >= MAX_CACHE_SIZE) {
    const oldest = suggestionCache.keys().next().value;
    if (oldest !== undefined) suggestionCache.delete(oldest);
  }
  suggestionCache.set(key, { data, timestamp: Date.now() });
}

function mapBackendSuggestion(s: BackendSuggestion): GaSuggestion {
  return {
    text: s.text,
    type: "phrase",
    phonetic: s.phonetic,
    english: s.english,
    description: s.context,
    ...(s.match ? { category: s.match } : {}),
  };
}

export function useGaSuggestions() {
  const [suggestions, setSuggestions] = useState<GaSuggestion[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [source, setSource] = useState<"static" | "api">("static");
  const [justUpgraded, setJustUpgraded] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const upgradeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchFromAPI = useCallback(
    async (input: string, conversationContext?: string): Promise<GaSuggestion[] | null> => {
      const key = cacheKey(input, conversationContext);
      const cached = getFromCache(key);
      if (cached) return cached;

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const response = await fetch(`${API_URL}/suggestions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            input,
            context: conversationContext || "",
            language: "ga",
          }),
          signal: controller.signal,
        });

        if (!response.ok) return null;

        const data = await response.json();
        const mapped = (data.suggestions || []).map(mapBackendSuggestion);
        if (mapped.length > 0) setCache(key, mapped);
        return mapped.length > 0 ? mapped : null;
      } catch {
        return null;
      }
    },
    []
  );

  const getSuggestions = useCallback(
    async (input: string, conversationContext?: string) => {
      if (!input || input.length < 1) {
        setSuggestions([]);
        setIsLoading(false);
        return;
      }

      // Static fallback is instant — show it immediately
      const staticResults = getGaSuggestions(input, 8);
      setSuggestions(staticResults);
      setSource("static");
      setIsLoading(false);

      // Debounce the API call
      if (debounceRef.current) clearTimeout(debounceRef.current);

      debounceRef.current = setTimeout(async () => {
        if (input.length < 2) return; // API needs at least 2 chars for prefix matching

        setIsLoading(true);
        const apiResults = await fetchFromAPI(input, conversationContext);

        if (apiResults && apiResults.length > 0) {
          // Merge: API results first (verified KB), then fill with static
          const apiTexts = new Set(apiResults.map((r) => r.text));
          const fillers = staticResults.filter((s) => !apiTexts.has(s.text));
          setSuggestions([...apiResults, ...fillers].slice(0, 8));
          setSource("api");
          setJustUpgraded(true);
          if (upgradeTimeoutRef.current) clearTimeout(upgradeTimeoutRef.current);
          upgradeTimeoutRef.current = setTimeout(() => setJustUpgraded(false), 400);
        }
        setIsLoading(false);
      }, DEBOUNCE_MS);
    },
    [fetchFromAPI]
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (upgradeTimeoutRef.current) clearTimeout(upgradeTimeoutRef.current);
      abortRef.current?.abort();
    };
  }, []);

  return {
    suggestions,
    getSuggestions,
    isLoading,
    source,
    justUpgraded,
  };
}
