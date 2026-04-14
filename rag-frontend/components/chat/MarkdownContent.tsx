"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import React, { useState } from "react";
import { Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface MarkdownContentProps {
  content: string;
  className?: string;
}

export function MarkdownContent({ content, className }: MarkdownContentProps) {
  const renderEnhancedText = (text: string) => {
    // 1. Define Patterns
    const patterns = [
      {
        // Bible Citations: Mose klɛŋklɛŋ wolo, Yitso [Num/Word], Kuku [Num/Word] (Genesis 1:1)
        regex: /(.*?, Yitso .*?, (?:Kuku ni ji |Kuku ).*? \(.*?\d+:\d+\))/g,
        render: (match: string, i: number) => (
          <span 
            key={`ref-${i}`} 
            className="text-[0.85rem] sm:text-[0.95rem] font-bold font-ibm tracking-[0.01em] sm:tracking-tight text-white border-l-2 border-primary/50 pl-2 sm:pl-3 my-3 block bg-white/5 py-2 pr-2 rounded-r break-words"
          >
            {match}
          </span>
        )
      },
      {
        // Bible Language Labels: Ga Version: ... or English Version: ...
        regex: /((?:Ga|English)\s*(?:Version:)?\s*.*?\s*(?:\(.*?\))?:)/g,
        render: (match: string, i: number) => (
          <span 
            key={`lang-${i}`} 
            className="text-[0.75rem] sm:text-[0.85rem] font-bold font-ibm uppercase tracking-[0.15em] sm:tracking-widest text-primary/90 mt-5 mb-3 block border-l border-primary/30 pl-2 break-words"
          >
            {match}
          </span>
        )
      },
      {
        // Source Tag: [Source: name] or Source: name
        regex: /((?:\[Source:\s*.*?\]|Source:\s*.*))/gi,
        render: (match: string, i: number) => {
          if (!match) return null;
          const name = match.replace(/\[Source:\s*|\]|Source:\s*/gi, "").trim();
          if (!name) return null;
          return (
            <span key={`src-${i}`} className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-[0.15em] bg-primary/5 text-primary/80 border border-primary/10 ml-2 shadow-sm">
              <span className="w-1 h-1 rounded-full bg-primary/40" />
              {name}
            </span>
          );
        }
      }
    ];

    // 2. Sequential Processing
    let elements: (string | React.ReactNode)[] = [text];

    patterns.forEach(({ regex, render }) => {
      const newElements: (string | React.ReactNode)[] = [];
      
      elements.forEach((element) => {
        if (typeof element !== "string") {
          newElements.push(element);
          return;
        }

        const parts = element.split(regex);
        parts.forEach((part, i) => {
          if (i % 2 === 1) {
            newElements.push(render(part, i));
          } else if (part) {
            newElements.push(part);
          }
        });
      });

      elements = newElements;
    });

    return elements;
  };

  const renderWithSources = (children: React.ReactNode) => {
    return React.Children.map(children, (child) => {
      if (typeof child === "string") {
        return renderEnhancedText(child);
      }
      return child;
    });
  };

  return (
    <div className={cn("markdown-content font-ibm font-normal leading-relaxed", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Headings
          h1: ({ node, ...props }) => (
            <h1 className="mb-4 mt-6 text-2xl font-bold font-ibm first:mt-0 text-white" {...props} />
          ),
          h2: ({ node, ...props }) => (
            <h2 className="mb-3 mt-5 text-xl font-semibold font-ibm first:mt-0 text-white/90" {...props} />
          ),
          h3: ({ node, ...props }) => (
            <h3 className="mb-2 mt-4 text-lg font-semibold font-ibm first:mt-0 text-white/90" {...props} />
          ),
          // Paragraphs
          p: ({ node, children, ...props }) => (
            <p className="mb-4 leading-7 last:mb-0 text-white/90 font-ibm font-normal" {...props}>
              {renderWithSources(children)}
            </p>
          ),
          // Lists
          ul: ({ node, ...props }) => (
            <ul className="mb-4 ml-6 list-disc space-y-2 text-white/90 font-ibm font-normal" {...props} />
          ),
          ol: ({ node, ...props }) => (
            <ol className="mb-4 ml-6 list-decimal space-y-2 text-white/90 font-ibm font-normal" {...props} />
          ),
          li: ({ node, children, ...props }) => (
            <li className="leading-relaxed" {...props}>
              <div className="prose prose-base prose-invert max-w-none">
                {renderWithSources(children)}
              </div>
            </li>
          ),
          // Tables
          table: ({ node, ...props }) => (
            <div className="my-6 w-full overflow-x-auto rounded-xl border border-neutral-200 dark:border-neutral-800">
              <table className="w-full border-collapse text-left text-sm" {...props} />
            </div>
          ),
          thead: ({ node, ...props }) => (
            <thead className="bg-neutral-50 dark:bg-neutral-900/50" {...props} />
          ),
          th: ({ node, ...props }) => (
            <th 
              className="border-b border-neutral-200 px-4 py-3 font-bold text-neutral-900 dark:border-neutral-800 dark:text-neutral-100" 
              {...props} 
            />
          ),
          td: ({ node, ...props }) => (
            <td 
              className="border-b border-neutral-100 px-4 py-3 text-neutral-700 dark:border-neutral-800/50 dark:text-neutral-300" 
              {...props} 
            />
          ),
          // Code blocks
          code: ({ node, inline, className, children, ...props }: any) => {
            const match = /language-(\w+)/.exec(className || "");
            const codeString = String(children).replace(/\n$/, "");
            const language = match ? match[1] : "";

            // Render code block if not inline and has language or is a block
            if (!inline && (language || codeString.includes("\n"))) {
              return (
                <CodeBlock code={codeString} language={language || "text"} />
              );
            }

            // Inline code
            return (
              <code
                className="rounded bg-neutral-200 px-1.5 py-0.5 text-sm font-mono dark:bg-neutral-700"
                {...props}
              >
                {children}
              </code>
            );
          },
          // Links
          a: ({ node, ...props }) => (
            <a
              className="text-blue-600 underline hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
              target="_blank"
              rel="noopener noreferrer"
              {...props}
            />
          ),
          // Blockquotes
          blockquote: ({ node, ...props }) => (
            <blockquote
              className="my-4 border-l-4 border-neutral-300 pl-4 italic text-neutral-600 dark:border-neutral-600 dark:text-neutral-400"
              {...props}
            />
          ),
          // Horizontal rule
          hr: ({ node, ...props }) => (
            <hr className="my-6 border-neutral-300 dark:border-neutral-700" {...props} />
          ),
          // Strong/Bold
          strong: ({ node, ...props }) => (
            <strong className="font-semibold" {...props} />
          ),
          // Emphasis/Italic
          em: ({ node, ...props }) => (
            <em className="italic" {...props} />
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

interface CodeBlockProps {
  code: string;
  language: string;
}

function CodeBlock({ code, language }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      toast.success("Code copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      toast.error("Failed to copy code");
    }
  };

  return (
    <div className="relative my-4 group/code">
      <div className="absolute right-2 top-2 z-10">
        <Button
          variant="ghost"
          size="icon"
          onClick={handleCopy}
          className="h-8 w-8 bg-neutral-800/80 hover:bg-neutral-700/80 text-neutral-200 opacity-0 group-hover/code:opacity-100 transition-opacity"
        >
          {copied ? (
            <Check className="h-4 w-4" />
          ) : (
            <Copy className="h-4 w-4" />
          )}
        </Button>
      </div>
      <SyntaxHighlighter
        language={language}
        style={vscDarkPlus}
        customStyle={{
          margin: 0,
          borderRadius: "0.5rem",
          padding: "1rem",
          fontSize: "0.875rem",
        }}
        PreTag="div"
      >
        {code}
      </SyntaxHighlighter>
    </div>
  );
}

