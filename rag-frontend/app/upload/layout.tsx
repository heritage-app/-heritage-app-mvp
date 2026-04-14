"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiClient } from "@/lib/api/client";
import { Shield } from "lucide-react";
import { toast } from "sonner";

export default function UploadLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [isVerifying, setIsVerifying] = useState(true);

  useEffect(() => {
    const checkUser = async () => {
      try {
        const response = await apiClient.get('/auth/me');
        const user = response.data;
        
        if (!user || (user.role !== 'admin' && user.role !== 'moderator')) {
          toast.error("Access restricted: Please sign in as an administrator to upload documents.");
          router.push("/");
          return;
        }

        setIsVerifying(false);
      } catch (error) {
        console.error("Auth check failed:", error);
        router.push("/");
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
          <span className="text-[10px] font-black uppercase tracking-[0.3em] text-white/20">Verifying Admin Status</span>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
