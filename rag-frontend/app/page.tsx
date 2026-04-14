import Image from "next/image"
import { GaChatHero } from "@/components/ga-chat-hero"

export default function Home() {
  return (
    <main className="relative bg-[#0a0a0a] selection:bg-primary/30 selection:text-foreground overflow-x-hidden dark min-h-screen">
      {/* Cinematic Background Image with Gradient Overlay */}
      <div className="absolute inset-0 z-0">
        <Image
          src="/heritage_dark_hero_bg_1775727472648.png"
          alt="Ga Heritage Background"
          fill
          className="object-cover opacity-60"
          priority
        />
        <div className="absolute inset-0 bg-gradient-to-b from-[#0a0a0a]/90 via-[#0a0a0a]/40 to-[#0d0d0d]" />
      </div>

      {/* Film grain for cinematic texture */}
      <div className="grain-overlay" />
      
      <div className="relative z-10">
        <GaChatHero />
      </div>

      {/* Premium Minimalist Footer */}
      <footer className="relative border-t border-foreground/5 bg-transparent px-6 py-16 sm:px-8 lg:px-12 text-foreground">
        <div className="mx-auto max-w-7xl">
          <div className="grid grid-cols-1 gap-12 md:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-4">
              <span className="text-xl font-black tracking-tighter text-foreground">Ga AI.</span>
              <p className="max-w-xs text-sm leading-relaxed text-foreground/70">
                A specialized linguistic engine dedicated to the preservation and fluent translation of the Ga language.
              </p>
            </div>
            
            <div className="flex flex-col gap-4">
              <span className="text-[0.65rem] font-bold uppercase tracking-[0.4em] text-foreground/60">Legal & Support</span>
              <nav className="flex flex-col gap-3 text-xs font-semibold text-foreground/70">
                {["Privacy Policy", "Terms of Service", "Contact Us"].map((link) => (
                  <a key={link} href="#" className="transition-all hover:text-foreground hover:translate-x-1">
                    {link}
                  </a>
                ))}
              </nav>
            </div>

            <div className="flex flex-col justify-between items-start lg:items-end">
              <div className="space-y-1 text-left lg:text-right">
                <p className="text-[0.65rem] font-bold uppercase tracking-[0.4em] text-primary">Mission Statement</p>
                <p className="text-xs font-medium italic text-foreground/50 truncate">"Language technology in service of culture."</p>
              </div>
              <p className="mt-8 text-[0.6rem] font-medium tracking-[0.3em] text-foreground/40 uppercase">
                © 2026 Ga Language AI • Crafted with Respect
              </p>
            </div>
          </div>
        </div>
      </footer>
    </main>
  );
}
