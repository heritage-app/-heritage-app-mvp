"use client";

import { 
  LayoutDashboard, 
  FileText, 
  Settings, 
  Shield, 
  Users,
  BookOpen,
  Menu,
  X
} from "lucide-react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useEffect, useState, createContext, useContext } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { apiClient } from "@/lib/api/client";
import { useUserStore } from "@/store/userStore";

interface AdminUser {
  id: string;
  email: string;
  role: string;
  display_name: string;
  first_name?: string;
  last_name?: string;
}

const AdminContext = createContext<AdminUser | null>(null);

export function useAdminUser() {
  return useContext(AdminContext);
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [isVerifying, setIsVerifying] = useState(true);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [adminUser, setAdminUser] = useState<AdminUser | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { setProfile } = useUserStore();

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
        const hasAdminRole = user.role === 'admin' || user.role === 'moderator';

        if (!hasAdminRole) {
          toast.error("Access Denied: Administrative privileges required.");
          router.push("/");
          return;
        }

        setUserRole(user.role);
        setAdminUser(user);
        setProfile(user);
        setIsVerifying(false);
      } catch (error) {
        toast.error("Session expired or invalid. Please sign in again.");
        window.location.href = "/";
      }
    };

    checkUser();
  }, [router, setProfile]);

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
    <AdminContext.Provider value={adminUser}>
      <div className="flex h-screen overflow-hidden bg-[#0d0d0d]">
        <button 
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="fixed top-4 left-4 z-50 p-2 rounded-lg bg-[#1c1c1c] border border-white/5 text-white/60 hover:text-white lg:hidden"
        >
          {sidebarOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>

        {sidebarOpen && (
          <div 
            className="fixed inset-0 bg-black/50 z-30 lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        <div className={cn(
          "w-56 sm:w-64 shrink-0 bg-[#0d0d0d] border-r border-white/5 flex flex-col z-40 fixed lg:relative inset-y-0 left-0 transition-transform duration-300",
          sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        )}>
          <div className="p-4 sm:p-6 flex items-center gap-3 mt-14 lg:mt-0">
            <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center border border-primary/20">
              <Shield className="h-5 w-5 text-primary" />
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] font-black uppercase tracking-[0.3em] text-primary/60">Admin Control</span>
              <span className="text-sm font-black text-white tracking-tight">Heritage Engine</span>
            </div>
          </div>

          <nav className="flex-1 px-2 sm:px-3 space-y-1 mt-4 sm:mt-6">
            {filteredNav.map((item) => {
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setSidebarOpen(false)}
                  className={cn(
                    "flex items-center gap-3 px-3 sm:px-4 py-3 rounded-xl text-sm font-bold transition-all group",
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

        <div className="flex-1 flex flex-col min-w-0 bg-[#141414] overflow-y-auto scrollbar-hide">
          <header className="h-14 sm:h-16 border-b border-white/5 flex items-center justify-between px-4 sm:px-6 md:px-8 shrink-0">
            <div className="flex items-center gap-4">
              <h2 className="text-xs sm:text-sm font-bold text-white uppercase tracking-[0.2em] ml-10 sm:ml-0">
                {filteredNav.find(n => n.href === pathname)?.name || "Management"}
              </h2>
            </div>
            <div className="flex items-center gap-3 sm:gap-4">
              <div className="flex items-center gap-2 px-2 sm:px-3 py-1 rounded-full bg-primary/5 border border-primary/10">
                <span className="h-1.5 sm:h-2 w-1.5 sm:w-2 rounded-full bg-green-500 animate-pulse" />
                <span className="text-[8px] sm:text-[10px] font-bold text-primary uppercase tracking-tighter">System Live</span>
              </div>
            </div>
          </header>

          <main className="flex-1 p-4 sm:p-6 md:p-8">
            {children}
          </main>
        </div>
      </div>
    </AdminContext.Provider>
  );
}