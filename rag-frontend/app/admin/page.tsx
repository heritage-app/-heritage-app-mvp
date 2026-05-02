"use client";

import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";
import { Users, MessageSquare, FileText, Activity, ShieldAlert, Cpu, UserCheck, ArrowUpRight } from "lucide-react";
import { motion } from "framer-motion";
import Link from "next/link";
import { apiClient } from "@/lib/api/client";
import { useUserStore } from "@/store/userStore";

interface SystemStats {
  total_documents: number;
  registered_users: number;
  user_conversations: number;
  guest_conversations: number;
  total_conversations: number;
  status: string;
  timestamp: string;
}

export default function AdminDashboard() {
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [loading, setLoading] = useState(true);
  const { profile } = useUserStore();

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const statsRes = await apiClient.get('/admin/stats');
        setStats(statsRes.data);
      } catch (error) {
        console.error("Failed to fetch stats:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
  }, []);

  const statCards = [
    { label: "Registered Users", value: stats?.registered_users || 0, icon: Users, color: "text-blue-400", bg: "bg-blue-400/10", href: "/admin/users" },
    { label: "Member Chats", value: stats?.user_conversations || 0, icon: MessageSquare, color: "text-emerald-400", bg: "bg-emerald-400/10" },
    { label: "Guest Chats", value: stats?.guest_conversations || 0, icon: Activity, color: "text-amber-400", bg: "bg-amber-400/10" },
    { label: "Heritage Docs", value: stats?.total_documents || 0, icon: FileText, color: "text-primary", bg: "bg-primary/10", href: "/admin/documents" },
  ];

  return (
    <div className="space-y-12">
      {/* Welcome Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="space-y-1">
          <h2 className="text-3xl font-black text-white tracking-tighter">
            Welcome back, <span className="text-primary italic">
              {profile?.first_name ? `${profile.first_name} ${profile.last_name || ""}` : (profile?.email?.split('@')[0] || "Administrator")}
            </span>
          </h2>
          <div className="flex items-center gap-2">
            <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-[10px] font-black uppercase tracking-[0.3em] text-white/30">
              {profile?.role?.toUpperCase() || "SYSTEM OPERATOR"} ACTIVE
            </span>
          </div>
        </div>
        
        <div className="flex items-center gap-4 bg-white/[0.03] border border-white/5 p-4 rounded-2xl">
           <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center border border-primary/20">
             <UserCheck className="h-5 w-5 text-primary" />
           </div>
           <div className="flex flex-col">
             <span className="text-[10px] font-black uppercase tracking-widest text-white/20">Authenticated as</span>
             <span className="text-xs font-bold text-white/80">{profile?.email || "checking session..."}</span>
           </div>
        </div>
      </div>

      {/* Header Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {statCards.map((card, i) => (
          <Link 
            key={card.label} 
            href={card.href || "#"}
            className={cn(
              "block focus:outline-none",
              !card.href && "pointer-events-none"
            )}
          >
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.1 }}
              className="p-6 rounded-2xl bg-[#1c1c1c] border border-white/5 hover:border-primary/30 transition-all group relative overflow-hidden"
            >
              <div className={cn("absolute top-0 right-0 w-32 h-32 -mr-16 -mt-16 rounded-full blur-3xl opacity-10", card.bg)} />
              
              <div className="flex items-center justify-between relative z-10">
                <div className={cn("p-2.5 rounded-xl", card.bg)}>
                  <card.icon className={cn("h-5 w-5", card.color)} />
                </div>
                {card.href && (
                  <ArrowUpRight className="h-4 w-4 text-white/10 group-hover:text-primary group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all" />
                )}
              </div>
              
              <div className="mt-6 relative z-10">
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/30">{card.label}</p>
                <h3 className="text-3xl font-black text-white mt-1 tracking-tighter">
                  {loading ? "..." : card.value}
                </h3>
              </div>
            </motion.div>
          </Link>
        ))}
      </div>

      {/* Main Sections */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Recent System Alerts */}
        <div className="p-8 rounded-3xl bg-[#1c1c1c] border border-white/5">
          <div className="flex items-center justify-between mb-8">
            <h3 className="text-sm font-black text-white uppercase tracking-widest">System Logs</h3>
            <ShieldAlert className="h-4 w-4 text-primary" />
          </div>
          
          <div className="space-y-4">
            {[1, 2, 3].map((_, i) => (
              <div key={i} className="flex gap-4 p-4 rounded-xl hover:bg-white/[0.02] transition-colors border border-transparent hover:border-white/5">
                <div className="h-2 w-2 rounded-full bg-primary mt-1.5" />
                <div className="flex flex-col">
                  <span className="text-[11px] font-bold text-white/40 uppercase tracking-tighter">10:4{i} AM</span>
                  <p className="text-sm text-white/80 mt-1 font-medium">New document indexed: <span className="text-primary font-bold">ga_proverbs_vol1.pdf</span></p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Engine Performance Card */}
        <div className="p-8 rounded-3xl bg-gradient-to-br from-[#1c1c1c] to-[#0d0d0d] border border-white/5 relative overflow-hidden group">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_120%,rgba(215,174,94,0.1),transparent)]" />
          
          <div className="relative z-10">
            <h3 className="text-sm font-black text-white uppercase tracking-widest mb-2">Linguistic Performance</h3>
            <p className="text-xl text-white font-bold tracking-tight">Engine state is <span className="text-primary underline decoration-primary/30 underline-offset-8">Perfect</span>.</p>
            
            <div className="mt-12 space-y-6">
              {[
                { label: "Indexing Latency", value: "0.2s" },
                { label: "Vector Search Recall", value: "99.2%" },
                { label: "Token Processing", value: "Stable" }
              ].map((metric) => (
                <div key={metric.label} className="flex items-center justify-between border-b border-white/5 pb-4">
                  <span className="text-xs font-bold text-white/30 uppercase tracking-[0.2em]">{metric.label}</span>
                  <span className="text-sm font-black text-white">{metric.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
