"use client";

import { useState, useEffect, useRef } from "react";

/**
 * A hook that takes a fast-streaming text and releases it character by character,
 * creating a smooth "typewriter" effect.
 *
 * @param text The raw text that is being updated from the stream.
 * @param speed The base typing speed in milliseconds per character.
 */
export function useTypewriter(text: string, speed: number = 20) {
  const [displayedContent, setDisplayedContent] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const fullTextRef = useRef(text);
  const currentIndexRef = useRef(0);
  const timeoutIdRef = useRef<NodeJS.Timeout | null>(null);

  // Keep the ref updated with the latest incoming text
  useEffect(() => {
    fullTextRef.current = text;
    // If we have text to reveal and we aren't currently "looping", start it
    if (text.length > currentIndexRef.current && !isTyping) {
      setIsTyping(true);
    }
  }, [text, isTyping]);

  useEffect(() => {
    if (!isTyping) return;

    const tick = () => {
      const remaining = fullTextRef.current.length - currentIndexRef.current;

      if (remaining > 0) {
        // Calculate batch size: if we are far behind, reveal more characters at once
        // to prevent the UI from lagging too far behind a fast stream.
        let batchSize = 1;
        if (remaining > 100) batchSize = 5;
        else if (remaining > 30) batchSize = 2;

        const nextChars = fullTextRef.current.slice(
          currentIndexRef.current,
          currentIndexRef.current + batchSize
        );

        setDisplayedContent((prev) => prev + nextChars);
        currentIndexRef.current += batchSize;

        // Schedule next tick
        timeoutIdRef.current = setTimeout(tick, speed);
      } else {
        setIsTyping(false);
      }
    };

    timeoutIdRef.current = setTimeout(tick, speed);

    return () => {
      if (timeoutIdRef.current) clearTimeout(timeoutIdRef.current);
    };
  }, [isTyping, speed]);

  // Reset logic if the input text is cleared (e.g., new conversation)
  useEffect(() => {
    if (text === "") {
      setDisplayedContent("");
      currentIndexRef.current = 0;
      setIsTyping(false);
      if (timeoutIdRef.current) clearTimeout(timeoutIdRef.current);
    }
  }, [text]);

  return { displayedContent, isTyping };
}
