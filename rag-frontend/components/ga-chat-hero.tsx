"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { motion, AnimatePresence } from "framer-motion"
import { Button } from "@/components/ui/button"

const CHAT_SAMPLES = [
  {
    prompt: "How do I say 'Good morning, how are you doing?' in Ga?",
    status: "Processing translation...",
    response: "In Ga, you would say: 'Ojekoo, Te oyɔɔ tɛŋŋ.'\n\nThis is a common and polite greeting used in everyday conversation."
  },
  {
    prompt: "How do I say Genesis 1:1 in Ga?",
    status: "Searching scriptures...",
    response: "Mose klɛŋklɛŋ wolo, Yitso ekome, Kuku ni ji ekome.\n\nThis refers to Genesis chapter 1, verse 1 in Ga."
  }
];

const timings = {
  promptStart: 1000,
  loadingStart: 3500,
  responseStart: 5500,
  cycleReset: 15000,
}

function useTypewriter(text: string, active: boolean, speed: number) {
  const [typedText, setTypedText] = useState("")

  useEffect(() => {
    if (!active) {
      setTypedText("")
      return
    }

    let index = 0
    const interval = window.setInterval(() => {
      index += 1
      setTypedText(text.slice(0, index))
      if (index >= text.length) window.clearInterval(interval)
    }, speed)

    return () => window.clearInterval(interval)
  }, [active, speed, text])

  return typedText
}

function FeatureCard({ title, description }: { title: string, description: string }) {
  return (
    <motion.div 
      whileHover={{ y: -4, backgroundColor: "var(--card)" }}
      className="flex flex-col gap-2 rounded-2xl border border-foreground/5 bg-foreground/[0.01] p-5 text-left transition-all hover:shadow-lg hover:shadow-foreground/[0.02]"
    >
      <div className="h-1 w-8 rounded-full bg-primary/30 mb-1" />
      <span className="text-[0.65rem] font-bold uppercase tracking-[0.3em] text-primary">{title}</span>
      <p className="text-[0.75rem] font-medium leading-relaxed text-foreground/50">{description}</p>
    </motion.div>
  )
}

import { AuthModal } from "./auth/AuthModal"
import { useUserStore } from "@/store/userStore"

export function GaChatHero() {
  const router = useRouter()
  const [phase, setPhase] = useState<"idle" | "prompt" | "loading" | "response">("idle")
  const [sampleIndex, setSampleIndex] = useState(0)
  const [mounted, setMounted] = useState(false)
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false)
  const { profile: userProfile } = useUserStore();
  const user = userProfile;

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    const runCycle = () => {
      setPhase("idle")
      const t1 = setTimeout(() => setPhase("prompt"), timings.promptStart)
      const t2 = setTimeout(() => setPhase("loading"), timings.loadingStart)
      const t3 = setTimeout(() => setPhase("response"), timings.responseStart)
      return [t1, t2, t3]
    }

    let timers = runCycle()
    const interval = setInterval(() => {
      timers.forEach(clearTimeout)
      setSampleIndex((prev) => (prev + 1) % CHAT_SAMPLES.length)
      timers = runCycle()
    }, timings.cycleReset)

    return () => {
      timers.forEach(clearTimeout)
      clearInterval(interval)
    }
  }, [])

  const currentSample = CHAT_SAMPLES[sampleIndex]
  const typedPrompt = useTypewriter(currentSample.prompt, phase !== "idle", 40)
  const typedResponse = useTypewriter(currentSample.response, phase === "response", 30)

  // Simplified mounting for troubleshooting
  if (!mounted) return <div className="min-h-[92svh] bg-black" />

  return (
    <section className="relative flex min-h-[92svh] w-full items-center justify-center overflow-hidden px-6 pt-24 pb-16 sm:px-12 bg-transparent text-foreground dark">
      
      {/* Background Gradients */}
      <div className="absolute inset-0 -z-10">
        <div className="absolute top-[-10%] left-[-10%] h-[500px] w-[500px] rounded-full bg-primary/20 blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-10%] h-[600px] w-[600px] rounded-full bg-red-900/20 blur-[150px]" />
      </div>

      <div className="relative z-10 grid w-full max-w-7xl grid-cols-1 items-center gap-16 lg:grid-cols-2">
        {/* Left Side: Value Prop */}
        <div className="flex flex-col items-start gap-12 text-left">
          <motion.div
            initial={{ opacity: 0, x: -30 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.8 }}
            className="space-y-6"
          >
            <span className="inline-block rounded-full border border-primary/30 bg-primary/10 px-4 py-1 text-[0.65rem] font-bold uppercase tracking-[0.4em] text-primary">
              Linguistic Heritage Preservation
            </span>
            <h1 className="text-4xl font-black tracking-tighter text-foreground sm:text-5xl md:text-6xl leading-[1.05]">
              Experience Ga with an AI <br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary via-[#e6c17a] to-primary/80">that understands home.</span>
            </h1>
            <p className="max-w-lg text-lg font-medium leading-relaxed text-foreground/70">
              The first neural translation engine dedicated to the oral traditions and cultural nuances of the Ga language.
            </p>
          </motion.div>

          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4, duration: 0.8 }}
            className="flex flex-wrap gap-4"
          >
            <Button 
              asChild
              className="h-14 rounded-full bg-gradient-to-br from-primary to-[#b88a3b] px-10 text-sm font-bold text-background transition-all hover:scale-105 hover:shadow-[0_10px_30px_rgba(215,174,94,0.3)]"
            >
              <Link href="/conversations/new">
                Start a Conversation
                <span className="ml-2">→</span>
              </Link>
            </Button>
          </motion.div>

          {/* Feature Grid Removed for Minimalism */}
        </div>

        {/* Right Side: Interactive Chat Mockup */}
        <div className="relative flex items-center justify-center">
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 40 }}
            animate={{ 
              opacity: 1, 
              scale: 1, 
              y: [0, -10, 0],
            }}
            transition={{ 
              opacity: { duration: 1 },
              scale: { duration: 1 },
              y: { duration: 10, repeat: Infinity, ease: "easeInOut" }
            }}
            className="realistic-glass relative w-full max-w-[520px] overflow-hidden rounded-[2.5rem] border-foreground/5 shadow-2xl"
          >
            {/* Window Controls - Realistic Browser Style */}
            <div className="flex items-center justify-between border-b border-foreground/[0.03] px-8 py-5">
              <div className="flex gap-2">
                <div className="h-3 w-3 rounded-full bg-foreground/[0.08]" />
                <div className="h-3 w-3 rounded-full bg-foreground/[0.08]" />
                <div className="h-3 w-3 rounded-full bg-foreground/[0.08]" />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[0.6rem] font-black uppercase tracking-[0.3em] text-foreground/20">Ga AI Interpreter</span>
                <div className="h-1.5 w-1.5 rounded-full bg-primary/40 animate-pulse" />
              </div>
            </div>

            {/* Chat Content */}
            <div className="min-h-[420px] space-y-8 p-10 bg-gradient-to-b from-transparent to-foreground/[0.01]">
              <AnimatePresence mode="wait">
                <motion.div 
                  key={sampleIndex}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="space-y-8"
                >
                  {phase !== "idle" && (
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="flex justify-end"
                    >
                      <div className="max-w-[85%] rounded-[1.4rem] rounded-br-[0.2rem] border border-foreground/[0.03] bg-foreground/[0.04] px-6 py-4 text-sm font-semibold text-foreground/80 shadow-sm backdrop-blur-xl">
                        {typedPrompt}
                        {phase === "prompt" && <span className="ml-[1px] inline-block h-4 w-[1.5px] animate-pulse bg-primary align-middle" />}
                      </div>
                    </motion.div>
                  )}

                  {(phase === "loading" || phase === "response") && (
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="flex flex-col gap-4"
                    >
                      <div className="flex items-center gap-3 ml-1">
                        <div className="h-6 w-6 rounded-lg bg-primary/10 flex items-center justify-center">
                          <div className="h-2 w-2 rounded-full bg-primary" />
                        </div>
                        <span className="text-[0.65rem] font-black uppercase tracking-[0.2em] text-foreground/30">Linguistic Engine</span>
                      </div>
                      <div className="max-w-[95%] rounded-[1.4rem] rounded-bl-[0.2rem] border border-primary/10 bg-background/40 px-7 py-6 shadow-xl glow-border">
                        {phase === "loading" ? (
                          <div className="flex flex-col gap-4 py-1">
                            <div className="flex gap-1.5">
                              {[0, 1, 2].map(i => (
                                <motion.div 
                                  key={i}
                                  animate={{ opacity: [0.3, 1, 0.3], y: [0, -3, 0] }}
                                  transition={{ repeat: Infinity, duration: 1.5, delay: i * 0.2 }}
                                  className="h-1.5 w-1.5 rounded-full bg-primary/60"
                                />
                              ))}
                            </div>
                            <span className="text-[0.7rem] font-bold italic tracking-wide text-foreground/20">{currentSample.status}</span>
                          </div>
                        ) : (
                          <div className="relative">
                            <p className="text-sm font-medium leading-relaxed text-foreground/80 whitespace-pre-wrap">
                              {typedResponse}
                              {typedResponse.length < currentSample.response.length && <span className="ml-[1px] inline-block h-4 w-[1.5px] animate-pulse bg-primary align-middle" />}
                            </p>
                          </div>
                        )}
                      </div>
                    </motion.div>
                  )}
                </motion.div>
              </AnimatePresence>
            </div>

            {/* Bottom Bar Mockup */}
            <div className="p-8 pt-0">
               <div className="relative flex h-14 items-center rounded-2xl bg-foreground/[0.02] border border-foreground/[0.03] px-5 transition-all">
                 <span className="text-xs font-medium text-foreground/10 italic">How do I say 'Welcome, my friend'...</span>
                 <div className="ml-auto flex gap-3">
                   <div className="h-7 w-12 rounded-lg bg-foreground/[0.04] flex items-center justify-center text-[0.6rem] font-black text-foreground/20 tracking-tighter shadow-inner">ENTER</div>
                   <div className="h-7 w-7 rounded-lg bg-primary flex items-center justify-center text-primary-foreground text-[0.8rem] shadow-lg shadow-primary/20 transition-transform hover:scale-105 active:scale-95 cursor-pointer">↑</div>
                 </div>
               </div>
            </div>
          </motion.div>

          {/* Background Realistic Shadow Depth */}
          <div className="absolute -z-20 h-[300px] w-[300px] rounded-full bg-primary/5 blur-[100px]" />
        </div>
      </div>

      <AuthModal 
        isOpen={isAuthModalOpen} 
        onClose={() => setIsAuthModalOpen(false)} 
      />
    </section>
  )
}
