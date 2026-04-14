"use client";
import { useParams } from "next/navigation";
import { ConversationShell } from "@/components/conversations/ConversationShell";

export default function ConversationsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const params = useParams();
  const id = params?.id as string;

  return (
    <ConversationShell conversationId={id || "new"}>
      {children}
    </ConversationShell>
  );
}
