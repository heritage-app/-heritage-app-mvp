"use client";

import { 
  Bot, 
  LayoutDashboard, 
  FileText, 
  Settings, 
  Shield, 
  Users,
  BookOpen
} from "lucide-react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { apiClient } from "@/lib/api/client";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [isVerifying, setIsVerifying] = useState(true);
  const [userRole, setUserRole] = useState<string | null>(null);

  // Filtered navigation based on role
  const filteredNav = [
    { name: "Overview", href: "/admin", icon: LayoutDashboard },
    ...(userRole === 'admin' ? [{ name: "User Management", href: "/admin/users", icon: Users }] : []),
    { name: "Document Library", href: "/admin/documents", icon: FileText },
    { name: "Bible Converter", href: "/admin/refiner", icon: BookOpen },
    { name: "System Settings", href: "/admin/settings", icon: Settings },
  ];

  useEffect(() => {
    const checkUser = async () => {
      try {
        const response = await apiClient.get('/auth/me');
        const user = response.data;
        
        const ADMIN_IDS = (process.env.NEXT_PUBLIC_ADMIN_IDS || "").split(",").map(id => id.trim());
        const isWhitelisted = ADMIN_IDS.includes(user.id);
        const hasAdminRole = user.role === 'admin' || user.role === 'moderator';

        if (!hasAdminRole && !isWhitelisted) {
          console.log("Access Denied for user:", user.id, "Role:", user.role);
          toast.error("Access Denied: Administrative privileges required.");
          router.push("/");
          return;
        }

        setUserRole(user.role || (isWhitelisted ? 'admin' : null));
        setIsVerifying(false);
      } catch (error) {
        console.error("Critical auth check failure:", error);
        toast.error("Session expired or invalid. Please sign in again.");
        try { await apiClient.post("/auth/logout"); } catch(e) {}
        window.location.href = "/";
      }
    };

    checkUser();
  }, [router]);

  if (isVerifying) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#0d0d0d]">
        <div className="flex flex-col items-center gap-4">
          <div className="h-10 w-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center animate-pulse">
            <Shield className="h-5 w-5 text-primary" />
          </div>
          <span className="text-[10px] font-black uppercase tracking-[0.3em] text-white/20">Verifying Credentials</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-[#0d0d0d]">
      {/* Admin Sidebar */}
      <div className="w-64 shrink-0 bg-[#0d0d0d] border-r border-white/5 flex flex-col z-40">
        <div className="p-6 flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center border border-primary/20">
            <Shield className="h-5 w-5 text-primary" />
          </div>
          <div className="flex flex-col">
            <span className="text-[10px] font-black uppercase tracking-[0.3em] text-primary/60">Admin Control</span>
            <span className="text-sm font-black text-white tracking-tight">Heritage Engine</span>
          </div>
        </div>

        <nav className="flex-1 px-3 space-y-1 mt-6">
          {filteredNav.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-bold transition-all group",
                  isActive 
                    ? "bg-primary/10 text-primary shadow-[0_0_20px_rgba(215,174,94,0.05)] border border-primary/10" 
                    : "text-white/40 hover:text-white hover:bg-white/5"
                )}
              >
                <item.icon className={cn("h-4 w-4 shrink-0", isActive ? "text-primary" : "text-white/40 group-hover:text-white")} />
                {item.name === "Document Library" ? "Heritage Archive" : item.name}
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-white/5">
          <Link 
            href="/conversations"
            className="flex items-center gap-3 px-4 py-3 rounded-xl text-xs font-bold uppercase tracking-widest text-white/20 hover:text-primary transition-colors"
          >
            ← Exit Admin
          </Link>
        </div>
      </div>

      {/* Main Admin Content */}
      <div className="flex-1 flex flex-col min-w-0 bg-[#141414] overflow-y-auto scrollbar-hide">
        <header className="h-16 border-b border-white/5 flex items-center justify-between px-8 shrink-0">
          <div className="flex items-center gap-4">
            <h2 className="text-sm font-bold text-white uppercase tracking-[0.2em]">
              {filteredNav.find(n => n.href === pathname)?.name || "Management"}
            </h2>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/5 border border-primary/10">
              <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
              <span className="text-[10px] font-bold text-primary uppercase tracking-tighter">System Live</span>
            </div>
          </div>
        </header>

        <main className="flex-1 p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
