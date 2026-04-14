"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogHeader, 
  DialogTitle 
} from "@/components/ui/dialog";
import { Bot, Mail, Lock, Loader2, ArrowRight, ShieldCheck } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { apiClient } from "@/lib/api/client";
import { useUserStore } from "@/store/userStore";

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultView?: "login" | "signup";
  adminOnly?: boolean;
}

export function AuthModal({ isOpen, onClose, defaultView = "login", adminOnly = false }: AuthModalProps) {
  const [view, setView] = useState<"login" | "signup">(adminOnly ? "login" : defaultView);
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const router = useRouter();

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      let response;
      if (view === "signup") {
        response = await apiClient.post("/auth/signup", {
          email,
          password,
        });
        toast.success("Account created! Welcome to Heritage Engine.");
      } else {
        response = await apiClient.post("/auth/login", {
          email,
          password,
        });
        toast.success("Welcome back to Heritage Engine!");
      }
      
      const { access_token, user } = response.data;
      
      if (access_token) {
        // HttpOnly cookies are set automatically by the backend.
        
        // Optionally update the Zustand store immediately
        useUserStore.getState().setProfile(user);
        
        onClose();
        
        // Hard redirect to clear Next.js client router cache and force middleware to run
        window.location.href = "/admin";
      }
    } catch (error: any) {
      toast.error(error.message || "Authentication failed");
    } finally {
      setLoading(false);
    }
  };

  const handleMagicLink = async () => {
    toast.error("Magic link is disabled in the custom authentication migration.");
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[420px] bg-[#0d0d0d] border-white/5 p-0 overflow-hidden rounded-3xl">
        <div className="absolute inset-0 bg-gradient-to-b from-primary/10 via-transparent to-transparent pointer-events-none" />
        
        <div className="relative p-8">
          <DialogHeader className="items-center text-center space-y-4 mb-8">
            <div className="h-14 w-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
              <ShieldCheck className="h-7 w-7 text-primary" />
            </div>
            <div>
              <DialogTitle className="text-2xl font-black text-white tracking-tight">
                {adminOnly ? "Admin Portal" : (view === "login" ? "Welcome Back" : "Start your Journey")}
              </DialogTitle>
              <DialogDescription className="text-white/40 font-medium uppercase tracking-widest text-[10px] mt-1">
                {adminOnly ? "Heritage Engine Management" : (view === "login" ? "Access your Heritage Repository" : "Join the Linguistic Preservation Engine")}
              </DialogDescription>
            </div>
          </DialogHeader>

          <form onSubmit={handleAuth} className="space-y-6">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email" className="text-[10px] font-black uppercase tracking-[0.2em] text-white/30 ml-1">Email Address</Label>
                <div className="relative">
                  <Mail className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-white/20" />
                  <Input 
                    id="email"
                    type="email"
                    placeholder="name@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="h-12 bg-[#1c1c1c] border-white/5 pl-12 rounded-xl text-white placeholder:text-white/20 focus:border-primary/50 transition-all font-jetbrains-mono"
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex justify-between items-center ml-1">
                  <Label htmlFor="password" title="password" className="text-[10px] font-black uppercase tracking-[0.2em] text-white/30">Password</Label>
                  {view === "login" && (
                    <button type="button" className="text-[10px] font-bold text-primary/60 hover:text-primary transition-colors">Forgot?</button>
                  )}
                </div>
                <div className="relative">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-white/20" />
                  <Input 
                    id="password"
                    type="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="h-12 bg-[#1c1c1c] border-white/5 pl-12 rounded-xl text-white placeholder:text-white/20 focus:border-primary/50 transition-all font-jetbrains-mono"
                    required
                  />
                </div>
              </div>
            </div>

            <div className="space-y-3 pt-2">
              <Button 
                type="submit" 
                disabled={loading}
                className="w-full h-12 bg-white text-[#0d0d0d] font-black text-xs uppercase tracking-[0.2em] hover:bg-primary transition-all rounded-xl"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : (
                  <span className="flex items-center gap-2">
                    {view === "login" ? "Sign In" : "Create Account"}
                    <ArrowRight className="h-3 w-4" />
                  </span>
                )}
              </Button>

              <Button 
                type="button"
                onClick={handleMagicLink}
                disabled={loading}
                variant="ghost" 
                className="w-full h-12 text-white/40 hover:text-white hover:bg-white/5 text-[10px] font-bold uppercase tracking-widest transition-all rounded-xl border border-white/5"
              >
                Sign in with Magic Link
              </Button>
            </div>
          </form>

          {!adminOnly && (
            <div className="mt-8 text-center">
              <p className="text-xs text-white/20 font-medium">
                {view === "login" ? "New to the engine?" : "Already have an account?"}{" "}
                <button 
                  onClick={() => setView(view === "login" ? "signup" : "login")}
                  className="text-primary font-bold hover:underline underline-offset-4 ml-1"
                >
                  {view === "login" ? "Create an account" : "Sign in here"}
                </button>
              </p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
