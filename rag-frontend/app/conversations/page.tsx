"use client";

import { ConversationList } from "@/components/conversations/ConversationList";
import { ChatWindow } from "@/components/chat/ChatWindow";
import { ChatInput } from "@/components/chat/ChatInput";
import { Button } from "@/components/ui/button";
import { Plus, Menu, X, PanelLeftClose, PanelLeftOpen, Bot } from "lucide-react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { useConversationStore } from "@/store/conversationStore";
import { useChatStore } from "@/store/chatStore";
import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

export default function ConversationsPage() {
  const router = useRouter();
  
  useEffect(() => {
    router.replace("/conversations/new");
  }, [router]);

  return (
    <div className="flex h-screen items-center justify-center bg-[#0d0d0d]">
      <div className="animate-pulse text-primary/40 text-[0.6rem] font-black uppercase tracking-[0.4em]">
        Redirecting to Engine...
      </div>
    </div>
  );
}



