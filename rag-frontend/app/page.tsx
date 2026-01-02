"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { MessageSquare, Upload, BookOpen, Languages, Sparkles, ArrowRight } from "lucide-react";

export default function Home() {
  const router = useRouter();

  return (
    <div className="min-h-screen bg-gradient-to-br from-neutral-50 via-white to-neutral-100 dark:from-neutral-950 dark:via-neutral-900 dark:to-neutral-950">
      {/* Hero Section */}
      <div className="relative overflow-visible">
        {/* Background Pattern */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px] [mask-image:radial-gradient(ellipse_80%_50%_at_50%_0%,#000_70%,transparent_110%)]" />
        
        <div className="relative mx-auto max-w-7xl px-4 pb-16 pt-16 sm:px-6 sm:pb-24 sm:pt-24 md:px-8 md:pb-28 md:pt-28 lg:px-12 lg:pt-32">
          <div className="mx-auto max-w-3xl text-center">
            {/* Badge */}
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-neutral-200 bg-white/80 px-3 py-1 text-xs sm:px-4 sm:py-1.5 sm:text-sm text-neutral-700 shadow-sm backdrop-blur-sm dark:border-neutral-800 dark:bg-neutral-900/80 dark:text-neutral-300">
              <Sparkles className="h-3 w-3 sm:h-4 sm:w-4 text-neutral-600 dark:text-neutral-400" />
              <span>Preserving Cultural Heritage</span>
            </div>

            {/* Main Heading */}
            <h1 className="mb-4 text-3xl font-bold tracking-tight text-neutral-900 sm:text-4xl sm:mb-5 md:text-5xl md:mb-6 lg:text-6xl dark:text-neutral-50 leading-tight">
              <span className="block">Learn Ga Language</span>
              <span className="block mt-2 sm:mt-3 bg-gradient-to-r from-neutral-900 via-neutral-700 to-neutral-900 bg-clip-text text-transparent dark:from-neutral-100 dark:via-neutral-300 dark:to-neutral-100">
                Preserve Heritage
              </span>
            </h1>

            {/* Description */}
            <p className="mx-auto mb-6 max-w-2xl text-sm leading-6 text-neutral-600 sm:text-base sm:leading-7 sm:mb-8 md:text-lg md:leading-8 dark:text-neutral-400 px-4">
              Master the Ga language through interactive conversations, cultural resources, and AI-powered learning. 
              Connect with your heritage and keep the language alive for future generations.
            </p>

            {/* CTA Buttons */}
            <div className="flex flex-col items-stretch gap-3 px-4 sm:flex-row sm:items-center sm:justify-center sm:gap-4 sm:px-0">
              <Button
                size="lg"
                onClick={() => router.push("/conversations")}
                className="group h-11 w-full px-6 text-sm font-semibold shadow-md transition-all hover:shadow-lg sm:w-auto sm:px-7"
              >
                <MessageSquare className="mr-2 h-4 w-4" />
                Start Learning
                <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
              </Button>
              <Button
                size="lg"
                variant="outline"
                onClick={() => router.push("/upload")}
                className="h-11 w-full px-6 text-sm font-semibold border-2 hover:bg-neutral-100 dark:hover:bg-neutral-800 sm:w-auto sm:px-7"
              >
                <Upload className="mr-2 h-4 w-4" />
                Upload Resources
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Features Section */}
      <div className="relative mx-auto max-w-7xl px-4 pb-16 sm:px-6 sm:pb-20 md:px-8 lg:px-12">
        <div className="mx-auto max-w-2xl text-center mb-8 sm:mb-10 md:mb-12">
          <h2 className="text-xl font-bold tracking-tight text-neutral-900 sm:text-2xl md:text-3xl dark:text-neutral-50">
            Everything you need to learn Ga
          </h2>
          <p className="mt-2 text-sm text-neutral-600 sm:mt-3 sm:text-base md:text-lg dark:text-neutral-400 px-4">
            Powerful features designed to make language learning engaging and effective
          </p>
        </div>

        <div className="grid gap-4 sm:gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {/* Feature 1 */}
          <div className="group relative rounded-xl border border-neutral-200 bg-white/60 p-4 shadow-sm transition-all hover:border-neutral-300 hover:shadow-md hover:bg-white/80 dark:border-neutral-800 dark:bg-neutral-900/60 dark:hover:border-neutral-700 dark:hover:bg-neutral-900/80 sm:p-6">
            <div className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-lg bg-neutral-100 dark:bg-neutral-800 sm:h-10 sm:w-10">
              <MessageSquare className="h-4 w-4 text-neutral-700 dark:text-neutral-300 sm:h-5 sm:w-5" />
            </div>
            <h3 className="mb-2 text-base font-semibold text-neutral-900 dark:text-neutral-50 sm:text-lg">
              Interactive Conversations
            </h3>
            <p className="text-xs leading-5 text-neutral-600 dark:text-neutral-400 sm:text-sm sm:leading-6">
              Practice Ga through natural conversations with AI-powered assistance. Get instant feedback and learn at your own pace.
            </p>
          </div>

          {/* Feature 2 */}
          <div className="group relative rounded-xl border border-neutral-200 bg-white/60 p-4 shadow-sm transition-all hover:border-neutral-300 hover:shadow-md hover:bg-white/80 dark:border-neutral-800 dark:bg-neutral-900/60 dark:hover:border-neutral-700 dark:hover:bg-neutral-900/80 sm:p-6">
            <div className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-lg bg-neutral-100 dark:bg-neutral-800 sm:h-10 sm:w-10">
              <BookOpen className="h-4 w-4 text-neutral-700 dark:text-neutral-300 sm:h-5 sm:w-5" />
            </div>
            <h3 className="mb-2 text-base font-semibold text-neutral-900 dark:text-neutral-50 sm:text-lg">
              Rich Learning Materials
            </h3>
            <p className="text-xs leading-5 text-neutral-600 dark:text-neutral-400 sm:text-sm sm:leading-6">
              Access curated cultural resources, documents, and learning materials to deepen your understanding of Ga language and heritage.
            </p>
          </div>

          {/* Feature 3 */}
          <div className="group relative rounded-xl border border-neutral-200 bg-white/60 p-4 shadow-sm transition-all hover:border-neutral-300 hover:shadow-md hover:bg-white/80 dark:border-neutral-800 dark:bg-neutral-900/60 dark:hover:border-neutral-700 dark:hover:bg-neutral-900/80 sm:p-6 sm:col-span-2 lg:col-span-1">
            <div className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-lg bg-neutral-100 dark:bg-neutral-800 sm:h-10 sm:w-10">
              <Languages className="h-4 w-4 text-neutral-700 dark:text-neutral-300 sm:h-5 sm:w-5" />
            </div>
            <h3 className="mb-2 text-base font-semibold text-neutral-900 dark:text-neutral-50 sm:text-lg">
              Cultural Preservation
            </h3>
            <p className="text-xs leading-5 text-neutral-600 dark:text-neutral-400 sm:text-sm sm:leading-6">
              Contribute to preserving Ga language and culture for future generations. Every conversation helps build a comprehensive language resource.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
