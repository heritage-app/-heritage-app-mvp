"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, CheckCircle2, FileJson, FileText, Database, Loader2, AlertTriangle, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { apiClient } from "@/lib/api/client";

interface RefinementPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  data: {
    raw_text: string;
    refined_records: any[];
    jsonl_preview: string;
    stats: {
      verse_count: number;
      chapters: number[];
    };
  } | null;
  filename: string;
  onComplete: () => void;
}

export function RefinementPreviewModal({ isOpen, onClose, data, filename, onComplete }: RefinementPreviewModalProps) {
  const [isCommitting, setIsCommitting] = useState(false);

  if (!data) return null;

  const handleCommit = async () => {
    setIsCommitting(true);
    try {
      await apiClient.post("/admin/refine/commit", {
        staged_records: data.refined_records,
        original_filename: filename
      });
      toast.success("Archival sequence committed successfully!");
      onComplete();
      onClose();
    } catch (error: any) {
      console.error("Commit failed:", error);
      toast.error(error.message || "Failed to commit refinement");
    } finally {
      setIsCommitting(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] bg-[#0d0d0d] flex flex-col"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-8 py-6 border-b border-white/5 bg-[#0d0d0d]">
            <div className="flex items-center gap-6">
              <div className="h-12 w-12 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                <FileJson className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h2 className="text-2xl font-black text-white tracking-tighter flex items-center gap-3">
                  Bible Refinement Preview
                  <span className="text-[10px] bg-white/5 px-2 py-1 rounded text-white/40 font-mono tracking-widest uppercase">Archival Mode</span>
                </h2>
                <p className="text-sm text-white/30 font-medium">Verify extraction for <span className="text-white font-bold">{filename}</span></p>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <div className="flex items-center gap-6 px-6 py-2 bg-white/[0.02] border border-white/5 rounded-2xl mr-4">
                 <div className="flex flex-col items-center">
                    <span className="text-[9px] font-black uppercase tracking-widest text-white/20">Verses</span>
                    <span className="text-sm font-black text-white">{data.stats.verse_count}</span>
                 </div>
                 <div className="w-px h-6 bg-white/5" />
                 <div className="flex flex-col items-center">
                    <span className="text-[9px] font-black uppercase tracking-widest text-white/20">Chapters</span>
                    <span className="text-sm font-black text-white">{data.stats.chapters.join(", ")}</span>
                 </div>
              </div>
              
              <Button 
                variant="ghost" 
                onClick={onClose}
                className="h-12 w-12 rounded-2xl hover:bg-white/5 text-white/40"
              >
                <X className="h-5 w-5" />
              </Button>
            </div>
          </div>

          {/* 3-Column Grid */}
          <div className="flex-1 grid grid-cols-1 lg:grid-cols-3 divide-x divide-white/5 overflow-hidden">
            
            {/* Column 1: Raw Output */}
            <div className="flex flex-col overflow-hidden bg-[#0d0d0d]">
              <div className="px-8 py-4 bg-white/[0.02] border-b border-white/5 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-white/40" />
                  <span className="text-[10px] font-black uppercase tracking-widest text-white/40">Raw Input Content</span>
                </div>
              </div>
              <div className="flex-1 p-8 overflow-y-auto scrollbar-hide font-mono text-[11px] leading-relaxed text-white/40 bg-zinc-950/30 whitespace-pre-wrap">
                {data.raw_text}
              </div>
            </div>

            {/* Column 2: Refined JSON */}
            <div className="flex flex-col overflow-hidden bg-[#0d0d0d]">
              <div className="px-8 py-4 bg-white/[0.02] border-b border-white/5 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Database className="h-4 w-4 text-primary" />
                  <span className="text-[10px] font-black uppercase tracking-widest text-white/40">Refined Verse Records</span>
                </div>
              </div>
              <div className="flex-1 p-8 overflow-y-auto space-y-4 bg-black/20">
                {data.refined_records.map((record, i) => (
                  <div key={i} className="p-4 rounded-xl border border-white/5 bg-white/[0.02] hover:border-primary/20 transition-all group">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] font-black text-primary uppercase tracking-tighter">Verse {record.verse_num}</span>
                      <span className="text-[9px] font-mono text-white/20">{record.id}</span>
                    </div>
                    <p className="text-xs font-bold text-white mb-2">{record.ga_verse_label}</p>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <span className="text-[9px] font-bold text-white/20 uppercase tracking-widest">Ga</span>
                        <p className="text-[11px] text-white/70 line-clamp-2">{record.ga}</p>
                      </div>
                      <div className="space-y-1">
                        <span className="text-[9px] font-bold text-white/20 uppercase tracking-widest">En</span>
                        <p className="text-[11px] text-white/70 line-clamp-2">{record.en}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Column 3: Archival Lineage (JSONL) */}
            <div className="flex flex-col overflow-hidden bg-[#0d0d0d]">
              <div className="px-8 py-4 bg-white/[0.02] border-b border-white/5 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                  <span className="text-[10px] font-black uppercase tracking-widest text-white/40">JSONL Archival Preview</span>
                </div>
              </div>
              <div className="flex-1 p-8 overflow-y-auto scrollbar-hide font-mono text-[9px] leading-loose text-emerald-500/40 bg-black/40 whitespace-pre">
                {data.jsonl_preview}
              </div>
            </div>
          </div>

          {/* Footer Actions */}
          <div className="p-8 border-t border-white/5 bg-[#0d0d0d] flex items-center justify-between">
            <div className="flex items-center gap-3 px-4 py-2 rounded-xl bg-primary/5 border border-primary/10">
              <AlertTriangle className="h-4 w-4 text-primary" />
              <p className="text-[10px] font-black text-primary uppercase tracking-widest">Ready to deploy to Heritage Vector Store</p>
            </div>

            <div className="flex items-center gap-4">
              <Button 
                variant="ghost" 
                onClick={onClose}
                className="h-12 px-6 rounded-2xl text-white/40 font-bold uppercase text-[10px] tracking-widest"
              >
                Cancel Archival
              </Button>
              <Button 
                onClick={handleCommit}
                disabled={isCommitting}
                className="h-14 px-10 rounded-2xl bg-white text-[#0d0d0d] font-black text-xs uppercase tracking-[0.2em] hover:bg-primary transition-all flex items-center gap-3 shadow-[0_0_30px_rgba(255,255,255,0.1)] group"
              >
                {isCommitting ? <Loader2 className="h-4 w-4 animate-spin text-black" /> : <ArrowRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" />}
                {isCommitting ? "Committing Lineage..." : "Finalize & Index Now"}
              </Button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
