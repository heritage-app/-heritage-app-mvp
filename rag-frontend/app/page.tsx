"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { MessageSquare, Upload, BookOpen, Languages, Sparkles, ArrowRight } from "lucide-react";

export default function Home() {
  const router = useRouter();

  return (
    <div className="min-h-screen bg-gradient-to-br from-neutral-50 via-white to-neutral-100 dark:from-neutral-950 dark:via-neutral-900 dark:to-neutral-950">
      {/* Hero Section */}
      <div className="relative overflow-hidden">
        {/* Background Pattern */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px] [mask-image:radial-gradient(ellipse_80%_50%_at_50%_0%,#000_70%,transparent_110%)]" />
        
        <div className="relative mx-auto max-w-7xl px-6 pb-24 pt-32 sm:px-8 sm:pb-32 sm:pt-40 lg:px-12">
          <div className="mx-auto max-w-3xl text-center">
            {/* Badge */}
            <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-neutral-200 bg-white/80 px-4 py-1.5 text-sm text-neutral-700 shadow-sm backdrop-blur-sm dark:border-neutral-800 dark:bg-neutral-900/80 dark:text-neutral-300">
              <Sparkles className="h-4 w-4 text-neutral-600 dark:text-neutral-400" />
              <span>Preserving Cultural Heritage</span>
            </div>

            {/* Main Heading */}
            <h1 className="mb-6 text-5xl font-bold tracking-tight text-neutral-900 sm:text-6xl lg:text-7xl dark:text-neutral-50">
              Learn Ga Language
              <span className="block mt-2 bg-gradient-to-r from-neutral-900 via-neutral-700 to-neutral-900 bg-clip-text text-transparent dark:from-neutral-100 dark:via-neutral-300 dark:to-neutral-100">
                Preserve Heritage
              </span>
            </h1>

            {/* Description */}
            <p className="mx-auto mb-10 max-w-2xl text-lg leading-8 text-neutral-600 sm:text-xl dark:text-neutral-400">
              Master the Ga language through interactive conversations, cultural resources, and AI-powered learning. 
              Connect with your heritage and keep the language alive for future generations.
            </p>

            {/* CTA Buttons */}
            <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
              <Button
                size="lg"
                onClick={() => router.push("/conversations")}
                className="group h-12 px-8 text-base font-semibold shadow-lg transition-all hover:shadow-xl"
              >
                <MessageSquare className="mr-2 h-5 w-5" />
                Start Learning
                <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
              </Button>
              <Button
                size="lg"
                variant="outline"
                onClick={() => router.push("/upload")}
                className="h-12 px-8 text-base font-semibold border-2 hover:bg-neutral-100 dark:hover:bg-neutral-800"
              >
                <Upload className="mr-2 h-5 w-5" />
                Upload Resources
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Features Section */}
      <div className="relative mx-auto max-w-7xl px-6 pb-24 sm:px-8 lg:px-12">
        <div className="mx-auto max-w-2xl text-center mb-16">
          <h2 className="text-3xl font-bold tracking-tight text-neutral-900 sm:text-4xl dark:text-neutral-50">
            Everything you need to learn Ga
          </h2>
          <p className="mt-4 text-lg text-neutral-600 dark:text-neutral-400">
            Powerful features designed to make language learning engaging and effective
          </p>
        </div>

        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
          {/* Feature 1 */}
          <div className="group relative rounded-2xl border border-neutral-200 bg-white/50 p-8 shadow-sm transition-all hover:border-neutral-300 hover:shadow-md dark:border-neutral-800 dark:bg-neutral-900/50 dark:hover:border-neutral-700">
            <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-neutral-100 dark:bg-neutral-800">
              <MessageSquare className="h-6 w-6 text-neutral-700 dark:text-neutral-300" />
            </div>
            <h3 className="mb-2 text-xl font-semibold text-neutral-900 dark:text-neutral-50">
              Interactive Conversations
            </h3>
            <p className="text-neutral-600 dark:text-neutral-400">
              Practice Ga through natural conversations with AI-powered assistance. Get instant feedback and learn at your own pace.
            </p>
          </div>

          {/* Feature 2 */}
          <div className="group relative rounded-2xl border border-neutral-200 bg-white/50 p-8 shadow-sm transition-all hover:border-neutral-300 hover:shadow-md dark:border-neutral-800 dark:bg-neutral-900/50 dark:hover:border-neutral-700">
            <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-neutral-100 dark:bg-neutral-800">
              <BookOpen className="h-6 w-6 text-neutral-700 dark:text-neutral-300" />
            </div>
            <h3 className="mb-2 text-xl font-semibold text-neutral-900 dark:text-neutral-50">
              Rich Learning Materials
            </h3>
            <p className="text-neutral-600 dark:text-neutral-400">
              Access curated cultural resources, documents, and learning materials to deepen your understanding of Ga language and heritage.
            </p>
          </div>

          {/* Feature 3 */}
          <div className="group relative rounded-2xl border border-neutral-200 bg-white/50 p-8 shadow-sm transition-all hover:border-neutral-300 hover:shadow-md dark:border-neutral-800 dark:bg-neutral-900/50 dark:hover:border-neutral-700 sm:col-span-2 lg:col-span-1">
            <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-neutral-100 dark:bg-neutral-800">
              <Languages className="h-6 w-6 text-neutral-700 dark:text-neutral-300" />
            </div>
            <h3 className="mb-2 text-xl font-semibold text-neutral-900 dark:text-neutral-50">
              Cultural Preservation
            </h3>
            <p className="text-neutral-600 dark:text-neutral-400">
              Contribute to preserving Ga language and culture for future generations. Every conversation helps build a comprehensive language resource.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
