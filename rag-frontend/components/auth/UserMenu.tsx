"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { 
  LogOut, 
  Settings, 
  User as UserIcon,
  ChevronsUpDown,
  ShieldCheck,
  CreditCard,
  LogIn
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { AuthModal } from "./AuthModal";
import { apiClient } from "@/lib/api/client";
import { useUserStore } from "@/store/userStore";

interface UserMenuProps {
  collapsed?: boolean;
  user?: any;
}

const ADMIN_IDS = (process.env.NEXT_PUBLIC_ADMIN_IDS || "").split(",").map(id => id.trim());

export function UserMenu({ collapsed, user: sessionUser }: UserMenuProps) {
  const { profile, displayName, clearProfile } = useUserStore();
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const router = useRouter();


  const handleSignOut = async () => {
    try {
      await apiClient.post("/auth/logout");
    } catch(err) {} 
    
    clearProfile();
    window.location.href = "/";
  };

  const isAdminOrMod = profile?.role === 'admin' || profile?.role === 'moderator';

  // Guest Mode View
  if (!sessionUser) {
    return (
      <>
        <Button 
          variant="ghost" 
          onClick={() => setIsAuthModalOpen(true)}
          className={cn(
            "w-full justify-start h-12 px-3 hover:bg-white/5 rounded-xl transition-all text-white/40 hover:text-white group",
            collapsed && "justify-center px-0"
          )}
        >
          <div className="flex items-center gap-3 w-full overflow-hidden">
            <div className="h-8 w-8 shrink-0 rounded-full bg-white/5 border border-white/10 flex items-center justify-center transition-colors group-hover:border-primary/50 group-hover:bg-primary/10">
              <LogIn className="h-4 w-4 text-white/40 group-hover:text-primary" />
            </div>
            {!collapsed && (
              <div className="flex flex-col items-start min-w-0 flex-1">
                <span className="text-[11px] font-bold uppercase tracking-tighter">Guest Explorer</span>
                <span className="text-[9px] text-white/20 font-black uppercase tracking-widest hidden group-hover:block transition-all text-primary/80">Login to save history</span>
                <span className="text-[9px] text-white/20 font-black uppercase tracking-widest block group-hover:hidden">Persistence Off</span>
              </div>
            )}
          </div>
        </Button>
        <AuthModal 
          isOpen={isAuthModalOpen} 
          onClose={() => setIsAuthModalOpen(false)} 
        />
      </>
    );
  }

  const userInitial = displayName.charAt(0).toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button 
          variant="ghost"
          className={cn(
            "w-full justify-start h-12 px-3 hover:bg-white/5 rounded-xl transition-all",
            collapsed && "justify-center px-0"
          )}
        >
          <div className="flex items-center gap-3 w-full overflow-hidden">
            <div className="h-8 w-8 shrink-0 rounded-full bg-gradient-to-tr from-primary/40 to-primary/10 flex items-center justify-center border border-primary/20 text-[10px] font-black text-primary">
              {userInitial}
            </div>
            {!collapsed && (
              <div className="flex flex-col items-start min-w-0 flex-1 text-white">
                <span className="text-[11px] font-bold truncate w-full uppercase tracking-tighter">
                  {displayName}
                </span>
                <span className="text-[9px] text-primary/60 font-black uppercase tracking-widest leading-none">
                  {profile?.role === 'admin' ? "Heritage Administrator" : 
                   profile?.role === 'moderator' ? "Content Moderator" : "Verified Member"}
                </span>
              </div>
            )}
            {!collapsed && <ChevronsUpDown className="h-3 w-3 text-white/20 shrink-0" />}
          </div>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56 bg-[#0d0d0d] border-white/5 text-white/60 p-1.5" side="right" align="end">
        <DropdownMenuLabel className="px-2 py-1.5 text-[10px] font-black uppercase tracking-widest text-white/20">
          Account Settings
        </DropdownMenuLabel>
        <DropdownMenuGroup>
          <DropdownMenuItem className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-white/5 hover:text-white cursor-pointer transition-colors group">
            <UserIcon className="h-4 w-4 group-hover:text-primary" />
            <span className="text-xs font-semibold">Profile</span>
          </DropdownMenuItem>
          {isAdminOrMod && (
            <DropdownMenuItem 
              onClick={() => router.push("/admin")}
              className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-white/5 hover:text-white cursor-pointer transition-colors group"
            >
              <ShieldCheck className="h-4 w-4 group-hover:text-primary" />
              <span className="text-xs font-semibold">Admin Dashboard</span>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-white/5 hover:text-white cursor-pointer transition-colors group">
            <Settings className="h-4 w-4 group-hover:text-primary" />
            <span className="text-xs font-semibold">Settings</span>
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator className="bg-white/5 my-1" />
        <DropdownMenuItem 
          onClick={handleSignOut}
          className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-red-500/10 hover:text-red-500 cursor-pointer transition-colors font-bold"
        >
          <LogOut className="h-4 w-4" />
          <span className="text-xs">Sign Out</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
