"use client";

import { useState, useEffect } from "react";
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogDescription 
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiClient } from "@/lib/api/client";
import { UserCheck, Calendar, ArrowRight, Loader2, User as UserIcon } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";

export function ProfileOnboarding() {
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [isVerifying, setIsVerifying] = useState(true);
  
  const [formData, setFormData] = useState({
    first_name: "",
    last_name: "",
    dob: ""
  });


  useEffect(() => {
    const checkProfileCompleteness = async () => {
      console.log("[Onboarding] Checking profile completeness...");
      try {
        const response = await apiClient.get('/auth/me');
        
        if (response.data) {
          const profile = response.data;
          console.log("[Onboarding] Profile received:", profile);
          
          // Show modal if profile is flagged as incomplete
          if (profile.is_complete === false) {
            console.log("[Onboarding] Profile incomplete, showing modal.");
            setFormData({
              first_name: profile.first_name || "",
              last_name: profile.last_name || "",
              dob: profile.dob || ""
            });
            setIsOpen(true);
          } else {
            console.log("[Onboarding] Profile is already complete.");
          }
        }
      } catch (error) {
        console.error("[Onboarding] Error during check:", error);
      } finally {
        setIsVerifying(false);
      }
    };

    checkProfileCompleteness();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const response = await apiClient.patch("/user/me", formData);

      if (response.status === 200) {
        toast.success("Profile updated successfully!");
        setIsOpen(false);
      } else {
        throw new Error("Failed to update profile");
      }
    } catch (error: any) {
      toast.error(error.message || "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  if (isVerifying || !isOpen) return null;

  return (
    <Dialog open={isOpen} onOpenChange={() => {}}>
      <DialogContent className="sm:max-w-[420px] bg-[#0d0d0d] border-white/5 p-0 overflow-hidden rounded-3xl">
        <div className="absolute inset-0 bg-gradient-to-b from-primary/10 via-transparent to-transparent pointer-events-none" />
        
        <div className="relative p-8">
          <DialogHeader className="items-center text-center space-y-4 mb-8">
            <div className="h-14 w-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
              <UserCheck className="h-7 w-7 text-primary" />
            </div>
            <div>
              <DialogTitle className="text-2xl font-black text-white tracking-tight uppercase">
                Complete your Profile
              </DialogTitle>
              <DialogDescription className="text-white/40 font-medium uppercase tracking-widest text-[10px] mt-1">
                Help us personalize your heritage engine experience
              </DialogDescription>
            </div>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="first_name" className="text-[10px] font-black uppercase tracking-[0.2em] text-white/30 ml-1">First Name</Label>
                <div className="relative">
                  <UserIcon className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-white/20" />
                  <Input 
                    id="first_name"
                    required
                    placeholder="Ekow"
                    value={formData.first_name}
                    onChange={(e) => setFormData({...formData, first_name: e.target.value})}
                    className="h-12 bg-[#1c1c1c] border-white/5 pl-12 rounded-xl text-white placeholder:text-white/20 focus:border-primary/50 transition-all text-sm font-medium"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="last_name" className="text-[10px] font-black uppercase tracking-[0.2em] text-white/30 ml-1">Last Name</Label>
                <div className="relative">
                  <Input 
                    id="last_name"
                    required
                    placeholder="Firmino"
                    value={formData.last_name}
                    onChange={(e) => setFormData({...formData, last_name: e.target.value})}
                    className="h-12 bg-[#1c1c1c] border-white/5 px-4 rounded-xl text-white placeholder:text-white/20 focus:border-primary/50 transition-all text-sm font-medium"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="dob" className="text-[10px] font-black uppercase tracking-[0.2em] text-white/30 ml-1">Date of Birth</Label>
              <div className="relative">
                <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-white/20" />
                <Input 
                  id="dob"
                  type="date"
                  required
                  value={formData.dob}
                  onChange={(e) => setFormData({...formData, dob: e.target.value})}
                  className="h-12 bg-[#1c1c1c] border-white/5 pl-12 rounded-xl text-white placeholder:text-white/20 focus:border-primary/50 transition-all font-jetbrains-mono text-sm uppercase"
                />
              </div>
            </div>

            <Button 
              type="submit" 
              disabled={loading}
              className="w-full h-12 bg-white text-[#0d0d0d] font-black text-xs uppercase tracking-[0.2em] hover:bg-primary transition-all rounded-xl mt-4 shrink-0"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : (
                <span className="flex items-center gap-2">
                  Finish Setup
                  <ArrowRight className="h-3 w-4" />
                </span>
              )}
            </Button>
          </form>
          
          <p className="mt-6 text-center text-[9px] text-white/10 font-bold uppercase tracking-widest leading-relaxed">
            Your data is stored securely in the heritage repository<br/>and only visible to you and system administrators.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
