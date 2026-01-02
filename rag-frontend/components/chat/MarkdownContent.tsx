"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface MarkdownContentProps {
  content: string;
  className?: string;
}

export function MarkdownContent({ content, className }: MarkdownContentProps) {
  return (
    <div className={cn("markdown-content", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Headings
          h1: ({ node, ...props }) => (
            <h1 className="mb-4 mt-6 text-2xl font-bold first:mt-0" {...props} />
          ),
          h2: ({ node, ...props }) => (
            <h2 className="mb-3 mt-5 text-xl font-semibold first:mt-0" {...props} />
          ),
          h3: ({ node, ...props }) => (
            <h3 className="mb-2 mt-4 text-lg font-semibold first:mt-0" {...props} />
          ),
          // Paragraphs
          p: ({ node, ...props }) => (
            <p className="mb-4 leading-7 last:mb-0 [&:has(code)]:mb-2" {...props} />
          ),
          // Lists
          ul: ({ node, ...props }) => (
            <ul className="mb-4 ml-6 list-disc space-y-2" {...props} />
          ),
          ol: ({ node, ...props }) => (
            <ol className="mb-4 ml-6 list-decimal space-y-2" {...props} />
          ),
          li: ({ node, ...props }) => (
            <li className="leading-7" {...props} />
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

