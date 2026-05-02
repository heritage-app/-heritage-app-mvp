"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X, CheckCircle2, FileJson, FileText, Database, Loader2,
  AlertTriangle, ArrowRight, Pencil, Check, Square, CheckSquare
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { apiClient } from "@/lib/api/client";

interface VerseRecord {
  id: string;
  verse_num: number;
  ga_verse_label: string;
  ga: string;
  en: string;
  chapter?: number;
  [key: string]: any;
}

interface RefinementData {
  raw_text: string;
  refined_records: VerseRecord[];
  jsonl_preview: string;
  stats: {
    verse_count: number;
    chapters: number[];
  };
}

interface RefinementPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  data: RefinementData | null;
  filename: string;
  onComplete: () => void;
}

export function RefinementPreviewModal({
  isOpen,
  onClose,
  data,
  filename,
  onComplete,
}: RefinementPreviewModalProps) {
  const [isCommitting, setIsCommitting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState({ ga: "", en: "" });
  const [editedRecords, setEditedRecords] = useState<Record<string, { ga: string; en: string }>>({});
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [chapterFilter, setChapterFilter] = useState<number | null>(null);

  // Reset all local state whenever a new file is staged
  useEffect(() => {
    if (data) {
      setSelectedIds(new Set(data.refined_records.map((r) => r.id)));
      setEditedRecords({});
      setEditingId(null);
      setChapterFilter(null);
    }
  }, [data]);

  if (!data) return null;

  const hasChapters = data.stats.chapters.length > 1;

  const filteredRecords =
    chapterFilter === null
      ? data.refined_records
      : data.refined_records.filter((r) => r.chapter === chapterFilter);

  const allFilteredSelected =
    filteredRecords.length > 0 && filteredRecords.every((r) => selectedIds.has(r.id));

  const toggleSelectAll = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) {
        filteredRecords.forEach((r) => next.delete(r.id));
      } else {
        filteredRecords.forEach((r) => next.add(r.id));
      }
      return next;
    });
  };

  const toggleRecord = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const startEdit = (record: VerseRecord) => {
    const existing = editedRecords[record.id];
    setEditDraft({ ga: existing?.ga ?? record.ga, en: existing?.en ?? record.en });
    setEditingId(record.id);
  };

  const saveEdit = () => {
    if (!editingId) return;
    setEditedRecords((prev) => ({ ...prev, [editingId]: editDraft }));
    setEditingId(null);
  };

  const cancelEdit = () => setEditingId(null);

  const handleCommit = async () => {
    const recordsToCommit = data.refined_records
      .filter((r) => selectedIds.has(r.id))
      .map((r) => ({ ...r, ...(editedRecords[r.id] || {}) }));

    if (recordsToCommit.length === 0) {
      toast.error("No records selected to commit.");
      return;
    }

    setIsCommitting(true);
    try {
      await apiClient.post("/admin/refine/commit", {
        staged_records: recordsToCommit,
        original_filename: filename,
      });
      toast.success(`${recordsToCommit.length} records committed successfully!`);
      onComplete();
      onClose();
    } catch (error: any) {
      console.error("Commit failed:", error);
      toast.error(error.message || "Failed to commit refinement");
    } finally {
      setIsCommitting(false);
    }
  };

  const editedCount = Object.keys(editedRecords).length;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] bg-[#0d0d0d] flex flex-col"
        >
          {/* ── Header ── */}
          <div className="shrink-0 flex items-center justify-between px-8 py-6 border-b border-white/5 bg-[#0d0d0d]">
            <div className="flex items-center gap-6">
              <div className="h-12 w-12 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                <FileJson className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h2 className="text-2xl font-black text-white tracking-tighter flex items-center gap-3">
                  Bible Refinement Preview
                  <span className="text-[10px] bg-white/5 px-2 py-1 rounded text-white/40 font-mono tracking-widest uppercase">
                    Archival Mode
                  </span>
                </h2>
                <p className="text-sm text-white/30 font-medium">
                  Verify extraction for{" "}
                  <span className="text-white font-bold">{filename}</span>
                </p>
              </div>
            </div>

            <div className="flex items-center gap-4">
              {/* Stats pill */}
              <div className="flex items-center gap-5 px-6 py-2 bg-white/[0.02] border border-white/5 rounded-2xl mr-4">
                <div className="flex flex-col items-center">
                  <span className="text-[9px] font-black uppercase tracking-widest text-white/20">Verses</span>
                  <span className="text-sm font-black text-white">{data.stats.verse_count}</span>
                </div>
                <div className="w-px h-6 bg-white/5" />
                <div className="flex flex-col items-center">
                  <span className="text-[9px] font-black uppercase tracking-widest text-white/20">Chapters</span>
                  <span className="text-sm font-black text-white">{data.stats.chapters.length}</span>
                </div>
                <div className="w-px h-6 bg-white/5" />
                <div className="flex flex-col items-center">
                  <span className="text-[9px] font-black uppercase tracking-widest text-white/20">Selected</span>
                  <span className="text-sm font-black text-primary">{selectedIds.size}</span>
                </div>
                {editedCount > 0 && (
                  <>
                    <div className="w-px h-6 bg-white/5" />
                    <div className="flex flex-col items-center">
                      <span className="text-[9px] font-black uppercase tracking-widest text-white/20">Edited</span>
                      <span className="text-sm font-black text-amber-400">{editedCount}</span>
                    </div>
                  </>
                )}
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

          {/* ── 3-Column Grid ── */}
          <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-3 divide-x divide-white/5 overflow-hidden">

            {/* Col 1 — Raw Input */}
            <div className="flex flex-col overflow-hidden bg-[#0d0d0d]">
              <div className="shrink-0 px-8 py-4 bg-white/[0.02] border-b border-white/5 flex items-center gap-2">
                <FileText className="h-4 w-4 text-white/40" />
                <span className="text-[10px] font-black uppercase tracking-widest text-white/40">
                  Raw Input Content
                </span>
              </div>
              <div className="flex-1 min-h-0 p-8 overflow-y-auto scrollbar-hide font-mono text-[11px] leading-relaxed text-white/40 bg-zinc-950/30 whitespace-pre-wrap">
                {data.raw_text}
              </div>
            </div>

            {/* Col 2 — Refined Records */}
            <div className="flex flex-col overflow-hidden bg-[#0d0d0d]">
              {/* Column controls */}
              <div className="shrink-0 px-4 py-3 bg-white/[0.02] border-b border-white/5 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Database className="h-4 w-4 text-primary" />
                    <span className="text-[10px] font-black uppercase tracking-widest text-white/40">
                      Refined Records
                    </span>
                  </div>
                  <button
                    onClick={toggleSelectAll}
                    className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-white/30 hover:text-primary transition-colors"
                  >
                    {allFilteredSelected ? (
                      <CheckSquare className="h-3.5 w-3.5 text-primary" />
                    ) : (
                      <Square className="h-3.5 w-3.5" />
                    )}
                    {allFilteredSelected ? "Deselect All" : "Select All"}
                  </button>
                </div>

                {/* Chapter filter tabs */}
                {hasChapters && (
                  <div className="flex flex-wrap gap-1 max-h-16 overflow-y-auto scrollbar-hide">
                    <button
                      onClick={() => setChapterFilter(null)}
                      className={cn(
                        "px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all",
                        chapterFilter === null
                          ? "bg-primary/20 text-primary border border-primary/30"
                          : "text-white/30 hover:text-white hover:bg-white/5"
                      )}
                    >
                      All
                    </button>
                    {data.stats.chapters.map((ch) => (
                      <button
                        key={ch}
                        onClick={() => setChapterFilter(ch)}
                        className={cn(
                          "px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all",
                          chapterFilter === ch
                            ? "bg-primary/20 text-primary border border-primary/30"
                            : "text-white/30 hover:text-white hover:bg-white/5"
                        )}
                      >
                        Ch {ch}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Record cards */}
              <div className="flex-1 min-h-0 p-4 overflow-y-auto space-y-3 bg-black/20">
                {filteredRecords.map((record) => {
                  const isSelected = selectedIds.has(record.id);
                  const isEditing = editingId === record.id;
                  const hasEdit = !!editedRecords[record.id];
                  const displayGa = editedRecords[record.id]?.ga ?? record.ga;
                  const displayEn = editedRecords[record.id]?.en ?? record.en;

                  return (
                    <div
                      key={record.id}
                      className={cn(
                        "p-4 rounded-xl border transition-all",
                        isSelected
                          ? "border-white/10 bg-white/[0.03]"
                          : "border-white/5 bg-transparent opacity-40",
                        isEditing && "border-primary/40 bg-primary/[0.03]",
                        hasEdit && !isEditing && "border-amber-500/20"
                      )}
                    >
                      {/* Card header row */}
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => toggleRecord(record.id)}
                            className="text-white/40 hover:text-primary transition-colors shrink-0"
                          >
                            {isSelected ? (
                              <CheckSquare className="h-3.5 w-3.5 text-primary" />
                            ) : (
                              <Square className="h-3.5 w-3.5" />
                            )}
                          </button>
                          <span className="text-[10px] font-black text-primary uppercase tracking-tighter">
                            {record.chapter != null ? `Ch ${record.chapter} · ` : ""}
                            Verse {record.verse_num}
                          </span>
                          {hasEdit && !isEditing && (
                            <span className="text-[8px] font-black text-amber-400 uppercase tracking-widest">
                              edited
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="text-[9px] font-mono text-white/20">
                            {record.id.split("-")[0]}
                          </span>
                          {!isEditing && (
                            <button
                              onClick={() => startEdit(record)}
                              className="h-6 w-6 rounded-lg flex items-center justify-center text-white/20 hover:text-primary hover:bg-primary/10 transition-all ml-1"
                              title="Edit verse"
                            >
                              <Pencil className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Verse label */}
                      <p className="text-[10px] font-bold text-white/40 mb-3 uppercase tracking-wider">
                        {record.ga_verse_label}
                      </p>

                      {/* Edit mode */}
                      {isEditing ? (
                        <div className="space-y-3">
                          <div className="space-y-1">
                            <span className="text-[9px] font-bold text-primary/60 uppercase tracking-widest">
                              Ga
                            </span>
                            <textarea
                              value={editDraft.ga}
                              onChange={(e) =>
                                setEditDraft((prev) => ({ ...prev, ga: e.target.value }))
                              }
                              rows={3}
                              autoFocus
                              className="w-full text-[11px] text-white bg-white/5 border border-primary/20 rounded-lg px-3 py-2 resize-none focus:outline-none focus:border-primary/50 font-medium leading-relaxed"
                            />
                          </div>
                          <div className="space-y-1">
                            <span className="text-[9px] font-bold text-white/30 uppercase tracking-widest">
                              En
                            </span>
                            <textarea
                              value={editDraft.en}
                              onChange={(e) =>
                                setEditDraft((prev) => ({ ...prev, en: e.target.value }))
                              }
                              rows={3}
                              className="w-full text-[11px] text-white bg-white/5 border border-white/10 rounded-lg px-3 py-2 resize-none focus:outline-none focus:border-white/30 font-medium leading-relaxed"
                            />
                          </div>
                          <div className="flex gap-2">
                            <button
                              onClick={saveEdit}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/20 text-primary text-[9px] font-black uppercase tracking-widest hover:bg-primary/30 transition-all"
                            >
                              <Check className="h-3 w-3" />
                              Save
                            </button>
                            <button
                              onClick={cancelEdit}
                              className="px-3 py-1.5 rounded-lg text-white/30 text-[9px] font-black uppercase tracking-widest hover:text-white hover:bg-white/5 transition-all"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        /* Read mode — no line-clamp, full verse visible */
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <span className="text-[9px] font-bold text-primary/60 uppercase tracking-widest">
                              Ga
                            </span>
                            <p className="text-[11px] text-white/70 leading-relaxed">{displayGa}</p>
                          </div>
                          <div className="space-y-1">
                            <span className="text-[9px] font-bold text-white/30 uppercase tracking-widest">
                              En
                            </span>
                            <p className="text-[11px] text-white/70 leading-relaxed">{displayEn}</p>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Col 3 — JSONL Preview */}
            <div className="flex flex-col overflow-hidden bg-[#0d0d0d]">
              <div className="shrink-0 px-8 py-4 bg-white/[0.02] border-b border-white/5 flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                <span className="text-[10px] font-black uppercase tracking-widest text-white/40">
                  JSONL Archival Preview
                </span>
              </div>
              <div className="flex-1 min-h-0 p-8 overflow-y-auto overflow-x-auto scrollbar-hide font-mono text-[9px] leading-loose text-emerald-500/40 bg-black/40 whitespace-pre">
                {data.jsonl_preview}
              </div>
            </div>
          </div>

          {/* ── Footer ── */}
          <div className="shrink-0 p-8 border-t border-white/5 bg-[#0d0d0d] flex items-center justify-between">
            <div className="flex items-center gap-3 px-4 py-2 rounded-xl bg-primary/5 border border-primary/10">
              <AlertTriangle className="h-4 w-4 text-primary" />
              <p className="text-[10px] font-black text-primary uppercase tracking-widest">
                {selectedIds.size} of {data.stats.verse_count} records will be indexed
              </p>
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
                disabled={isCommitting || selectedIds.size === 0}
                className="h-14 px-10 rounded-2xl bg-white text-[#0d0d0d] font-black text-xs uppercase tracking-[0.2em] hover:bg-primary transition-all flex items-center gap-3 shadow-[0_0_30px_rgba(255,255,255,0.1)] group disabled:opacity-30 disabled:cursor-not-allowed"
              >
                {isCommitting ? (
                  <Loader2 className="h-4 w-4 animate-spin text-black" />
                ) : (
                  <ArrowRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" />
                )}
                {isCommitting
                  ? "Committing Lineage..."
                  : `Finalize ${selectedIds.size} Records`}
              </Button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
