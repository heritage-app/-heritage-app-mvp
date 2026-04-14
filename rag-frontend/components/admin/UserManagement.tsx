"use client";

import { useEffect, useState } from "react";
import { Users, Shield, User, UserCheck, RefreshCw, Search, MoreVertical, Crown, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { apiClient } from "@/lib/api/client";
import { formatDateAbsolute } from "@/lib/utils/formatDate";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDown } from "lucide-react";

interface UserProfile {
  id: string;
  email: string;
  role: "admin" | "moderator" | "user" | "member";
  display_name?: string;
  first_name?: string;
  last_name?: string;
  dob?: string;
  created_at: string;
}

export function UserManagement() {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const response = await apiClient.get("/admin/users");
      setUsers(response.data.users);
    } catch (error: any) {
      console.error("Failed to fetch admin users:", error);
      toast.error(error.message || "Failed to sync user directory");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleRoleChange = async (userId: string, newRole: string) => {
    setUpdatingId(userId);
    try {
      const response = await apiClient.patch(`/admin/users/${userId}/role?role=${newRole}`);
      
      if (response.status === 200 || response.data.status === "success") {
        toast.success(`Role updated to ${newRole}`);
        setUsers(prev => prev.map(u => u.id === userId ? { ...u, role: newRole as any } : u));
      }
    } catch (error: any) {
      console.error("Role update error:", error);
      toast.error(error.message || "System error during role update");
    } finally {
      setUpdatingId(null);
    }
  };

  const filteredUsers = users.filter(u => {
    const searchLower = search.toLowerCase();
    return (
      u.email.toLowerCase().includes(searchLower) ||
      u.id.toLowerCase().includes(searchLower) ||
      (u.display_name && u.display_name.toLowerCase().includes(searchLower)) ||
      (u.first_name && u.first_name.toLowerCase().includes(searchLower)) ||
      (u.last_name && u.last_name.toLowerCase().includes(searchLower))
    );
  });

  return (
    <div className="space-y-8">
      {/* Control Bar */}
      <div className="flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center">
        <div className="relative w-full max-w-md">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-white/20" />
          <input 
            type="text"
            placeholder="Search users by name, email or ID..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-[#1c1c1c] border border-white/5 rounded-2xl py-3 pl-12 pr-4 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-primary/50 transition-all font-medium"
          />
        </div>
        
        <Button 
          onClick={fetchUsers}
          variant="ghost" 
          className="h-12 w-12 rounded-2xl bg-[#1c1c1c] border border-white/5 text-white/40 hover:text-white group"
        >
          <RefreshCw className={cn("h-4 w-4 transition-transform group-active:rotate-180", loading && "animate-spin")} />
        </Button>
      </div>

      {/* Users Table */}
      <div className="bg-[#1c1c1c] border border-white/5 rounded-3xl overflow-hidden">
        <div className="overflow-x-auto scrollbar-hide">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-white/5 bg-white/[0.02]">
                <th className="px-6 py-5 text-[10px] font-black uppercase tracking-[0.2em] text-white/30 whitespace-nowrap">Member Identity</th>
                <th className="px-6 py-5 text-[10px] font-black uppercase tracking-[0.2em] text-white/30 whitespace-nowrap">Access Level</th>
                <th className="px-6 py-5 text-[10px] font-black uppercase tracking-[0.2em] text-white/30 whitespace-nowrap">Join Date</th>
                <th className="px-6 py-5 text-right text-[10px] font-black uppercase tracking-[0.2em] text-white/30 whitespace-nowrap">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              <AnimatePresence mode="popLayout">
                {filteredUsers.map((profile) => (
                  <motion.tr 
                    key={profile.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0, x: -20 }}
                    className="group hover:bg-white/[0.01] transition-colors"
                  >
                    <td className="px-6 py-5">
                      <div className="flex items-center gap-4">
                        <div className="h-10 w-10 rounded-xl bg-white/5 border border-white/5 flex items-center justify-center">
                          {profile.role === 'admin' ? (
                            <Crown className="h-5 w-5 text-primary" />
                          ) : profile.role === 'moderator' ? (
                            <Shield className="h-5 w-5 text-emerald-400" />
                          ) : (
                            <User className="h-5 w-5 text-white/20" />
                          )}
                        </div>
                        <div className="flex flex-col">
                          <span className="text-sm font-bold text-white tracking-tight flex items-center gap-2">
                            {profile.display_name ? profile.display_name : profile.first_name ? `${profile.first_name} ${profile.last_name || ""}`.trim() : "Pending Registration"}
                            {profile.dob && (
                              <span className="h-1 w-1 rounded-full bg-white/20" />
                            )}
                            {profile.dob && (
                              <span className="text-[10px] font-black text-white/20 uppercase tracking-tighter flex items-center gap-1">
                                <Calendar className="h-2.5 w-2.5" />
                                {formatDateAbsolute(profile.dob).split(',')[0]}
                              </span>
                            )}
                          </span>
                          <span className="text-[10px] font-bold text-white/30 uppercase tracking-[0.1em]">
                            {profile.email}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-5">
                      <div className="flex items-center gap-2">
                         <div className={cn(
                           "h-1.5 w-1.5 rounded-full",
                           profile.role === 'admin' ? "bg-primary shadow-[0_0_8px_rgba(215,174,94,0.5)]" : 
                           profile.role === 'moderator' ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" : "bg-white/20"
                         )} />
                         <span className={cn(
                           "text-[10px] font-black uppercase tracking-widest",
                           profile.role === 'admin' ? "text-primary" : 
                           profile.role === 'moderator' ? "text-emerald-400" : "text-white/40"
                         )}>
                           {profile.role}
                         </span>
                      </div>
                    </td>
                    <td className="px-6 py-5">
                      <span className="text-xs font-bold text-white/30 uppercase tracking-tighter">
                        {formatDateAbsolute(profile.created_at).split(',')[0]}
                      </span>
                    </td>
                    <td className="px-6 py-5 text-right">
                      <div className="flex items-center justify-end">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button 
                              variant="ghost" 
                              disabled={updatingId === profile.id}
                              className="h-9 px-4 rounded-xl bg-white/5 border border-white/5 text-white/40 text-[10px] font-black uppercase tracking-widest hover:bg-white/10 hover:text-white transition-all flex items-center gap-2 group"
                            >
                              {updatingId === profile.id ? "Updating..." : "Action"}
                              <ChevronDown className="h-3 w-3 transition-transform group-data-[state=open]:rotate-180" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-48 bg-[#1c1c1c] border-white/5 shadow-2xl rounded-2xl p-2">
                            <DropdownMenuItem 
                              onClick={() => handleRoleChange(profile.id, 'admin')}
                              className="flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer hover:bg-primary/10 text-primary text-[10px] font-black uppercase tracking-widest"
                            >
                              <Crown className="h-4 w-4" />
                              Promote to Admin
                            </DropdownMenuItem>
                            <DropdownMenuItem 
                              onClick={() => handleRoleChange(profile.id, 'moderator')}
                              className="flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer hover:bg-emerald-500/10 text-emerald-400 text-[10px] font-black uppercase tracking-widest"
                            >
                              <Shield className="h-4 w-4" />
                              Set as Moderator
                            </DropdownMenuItem>
                            <DropdownMenuItem 
                              onClick={() => handleRoleChange(profile.id, 'user')}
                              className="flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer hover:bg-red-500/10 text-red-500 text-[10px] font-black uppercase tracking-widest"
                            >
                              <User className="h-4 w-4" />
                              Revoke Access
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </td>
                  </motion.tr>
                ))}
              </AnimatePresence>
            </tbody>
          </table>
        </div>
        
        {!loading && filteredUsers.length === 0 && (
          <div className="p-20 text-center">
            <div className="h-16 w-16 rounded-full bg-white/5 flex items-center justify-center mx-auto mb-6">
              <Users className="h-6 w-6 text-white/20" />
            </div>
            <h3 className="text-lg font-bold text-white">No members found</h3>
            <p className="text-sm text-white/20 mt-1 uppercase tracking-widest font-black">Refine your search parameters.</p>
          </div>
        )}
      </div>
    </div>
  );
}
