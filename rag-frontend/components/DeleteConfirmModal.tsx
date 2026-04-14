"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Trash2 } from "lucide-react";

interface DeleteConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title?: string;
  description?: string;
  loading?: boolean;
}

export function DeleteConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  title = "Delete document?",
  description = "This action will permanently remove this document from the system. This cannot be undone.",
  loading = false,
}: DeleteConfirmModalProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="bg-[#0d0d0d] border-white/5 max-w-md rounded-[2rem] p-8 shadow-2xl">
        <DialogHeader className="space-y-4">
          <div className="mx-auto w-16 h-16 rounded-3xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mb-2">
            <AlertTriangle className="h-8 w-8 text-red-500" />
          </div>
          <DialogTitle className="text-2xl font-black text-center text-white tracking-tight">
            {title}
          </DialogTitle>
          <DialogDescription className="text-center text-white/40 text-sm leading-relaxed font-medium">
            {description}
          </DialogDescription>
        </DialogHeader>
        
        <DialogFooter className="mt-8 flex flex-col sm:flex-row gap-3 sm:gap-4">
          <Button
            variant="ghost"
            onClick={onClose}
            disabled={loading}
            className="flex-1 h-14 rounded-2xl text-[13px] font-bold uppercase tracking-widest text-white/40 hover:text-white hover:bg-white/5 transition-all"
          >
            Cancel
          </Button>
          <Button
            onClick={onConfirm}
            disabled={loading}
            className="flex-1 h-14 rounded-2xl bg-red-500 hover:bg-red-600 text-white font-bold text-[13px] uppercase tracking-widest shadow-[0_4px_20px_rgba(239,68,68,0.3)] hover:shadow-[0_6px_25px_rgba(239,68,68,0.4)] transition-all flex items-center justify-center gap-3"
          >
            {loading ? (
              <span className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
            {loading ? "Deleting..." : "Confirm Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
