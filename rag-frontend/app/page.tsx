"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { MessageSquare, Upload } from "lucide-react";

export default function Home() {
  const router = useRouter();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-8">
      <Card className="w-full max-w-2xl p-12">
        <div className="text-center">
          <h1 className="mb-4 text-4xl font-bold">Heritage App</h1>
          <p className="mb-8 text-lg text-muted-foreground">
            Learn and preserve the Ga language through interactive conversations and cultural heritage.
          </p>

          <div className="flex flex-col gap-4 sm:flex-row sm:justify-center">
            <Button
              size="lg"
              onClick={() => router.push("/conversations")}
              className="w-full sm:w-auto"
            >
              <MessageSquare className="mr-2 h-5 w-5" />
              Start Conversation
            </Button>
            <Button
              size="lg"
              variant="outline"
              onClick={() => router.push("/upload")}
              className="w-full sm:w-auto"
            >
              <Upload className="mr-2 h-5 w-5" />
              Upload Material
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
