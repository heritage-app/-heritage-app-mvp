"use client"

import { useParams } from "next/navigation"
import { ChatWindow } from "@/components/chat/ChatWindow"

export default function ConversationDetailPage() {
  const params = useParams()
  const id = params?.id as string
  
  return <ChatWindow conversationId={id} />
}
