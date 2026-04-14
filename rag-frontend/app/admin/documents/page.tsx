"use client";

import { useEffect, useState, useRef } from "react";
import { FileText, Trash2, ExternalLink, Search, RefreshCw, UploadCloud, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { apiClient } from "@/lib/api/client";
import { DeleteConfirmModal } from "@/components/DeleteConfirmModal";

interface Document {
  id: string;
  original_filename: string;
  public_url: string;
  status: string;
  uploaded_at: string;
}

export default function AdminDocumentManager() {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [search, setSearch] = useState("");
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [documentToDelete, setDocumentToDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchDocuments = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const response = await apiClient.get('/admin/documents');
      if (response.status === 200) {
        setDocuments(response.data.documents);
      }
    } catch (error) {
      console.error("Failed to fetch admin documents:", error);
      if (!silent) toast.error("Failed to sync documents");
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    fetchDocuments();
  }, []);

  // Smart Polling: Refresh if any document is in a non-terminal state
  useEffect(() => {
    const hasActiveTasks = documents.some(doc => 
      ['uploading', 'uploaded', 'indexing'].includes(doc.status)
    );

    if (hasActiveTasks) {
      const interval = setInterval(() => {
        fetchDocuments(true); // Silent refresh
      }, 3000);
      return () => clearInterval(interval);
    }
  }, [documents]);

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 50 * 1024 * 1024) { 
      toast.error("File is too large (max 50MB)");
      return;
    }

    setUploading(true);
    const formData = new FormData();
    formData.append("file", file);

    try {
      await apiClient.post("/admin/upload", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      
      toast.success(`${file.name} processing started.`);
      fetchDocuments();
    } catch (error: any) {
      console.error("Upload failed:", error);
      toast.error(error.message || "Failed to process document");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDeleteClick = (id: string) => {
    setDocumentToDelete(id);
    setDeleteModalOpen(true);
  };

  const confirmDelete = async () => {
    if (!documentToDelete) return;
    
    setDeleting(true);
    try {
      const response = await apiClient.delete(`/admin/documents/${documentToDelete}`);
      
      if (response.status === 200) {
        setDocuments(prev => prev.filter(d => d.id !== documentToDelete));
        toast.success("Document deleted successfully");
        setDeleteModalOpen(false);
      } else {
        toast.error("Failed to delete document");
      }
    } catch (error: any) {
      console.error("Deletion failed:", error);
      toast.error(error.message || "Network error during deletion");
    } finally {
      setDeleting(false);
      setDocumentToDelete(null);
    }
  };

  const filteredDocs = documents.filter(doc => 
    doc.original_filename.toLowerCase().includes(search.toLowerCase()) ||
    doc.id.toLowerCase().includes(search.toLowerCase())
  );

  const StatusIndicator = ({ status }: { status: string }) => {
    const config: Record<string, { color: string, label: string, icon?: any }> = {
      uploading: { color: "bg-blue-500", label: "Uploading", icon: <Loader2 className="h-3 w-3 animate-spin" /> },
      uploaded: { color: "bg-sky-400", label: "Uploaded" },
      indexing: { color: "bg-amber-500", label: "Indexing", icon: <RefreshCw className="h-3 w-3 animate-spin" /> },
      indexed: { color: "bg-emerald-500", label: "Indexed" },
      error: { color: "bg-red-500", label: "Error" },
      unknown: { color: "bg-white/20", label: "Unknown" }
    };

    const current = config[status] || config.unknown;

    return (
      <div className="flex items-center gap-2">
        <div className={cn(
          "h-1.5 w-1.5 rounded-full",
          current.color,
          status !== 'indexed' && status !== 'error' && "animate-pulse shadow-[0_0_8px_rgba(59,130,246,0.5)]"
        )} />
        <span className={cn(
          "text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5",
          status === 'indexed' ? "text-emerald-500/80" : "text-white/60"
        )}>
          {current.icon}
          {current.label}
        </span>
      </div>
    );
  };

  return (
    <div className="space-y-8">
      {/* Hidden File Input */}
      <input 
        type="file" 
        ref={fileInputRef} 
        onChange={handleFileChange} 
        className="hidden" 
        accept=".pdf,.txt,.docx,.html,.md,.csv,.xlsx,.xls,.json,.jsonl"
      />

      {/* Control Bar */}
      <div className="flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center">
        <div className="relative w-full max-w-md">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-white/20" />
          <input 
            type="text"
            placeholder="Search documents by name or ID..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-[#1c1c1c] border border-white/5 rounded-2xl py-3 pl-12 pr-4 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-primary/50 transition-all font-medium"
          />
        </div>
        
        <div className="flex gap-3 w-full sm:w-auto">
          <Button 
            onClick={() => fetchDocuments()}
            variant="ghost" 
            className="h-12 w-12 rounded-2xl bg-[#1c1c1c] border border-white/5 text-white/40 hover:text-white group"
          >
            <RefreshCw className={cn("h-4 w-4 transition-transform group-active:rotate-180", loading && "animate-spin")} />
          </Button>
          <Button 
            onClick={handleUploadClick}
            disabled={uploading}
            className="flex-1 sm:flex-none h-12 px-6 rounded-2xl bg-white text-[#0d0d0d] font-bold text-xs uppercase tracking-widest hover:bg-primary transition-all flex items-center gap-3"
          >
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
            {uploading ? "Uploading..." : "Upload New"}
          </Button>
        </div>
      </div>

      {/* Document Table */}
      <div className="bg-[#1c1c1c] border border-white/5 rounded-3xl overflow-hidden">
        <div className="overflow-x-auto scrollbar-hide">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-white/5 bg-white/[0.02]">
                <th className="px-6 py-5 text-[10px] font-black uppercase tracking-[0.2em] text-white/30">Document</th>
                <th className="px-6 py-5 text-[10px] font-black uppercase tracking-[0.2em] text-white/30">ID</th>
                <th className="px-6 py-5 text-[10px] font-black uppercase tracking-[0.2em] text-white/30">Uploaded</th>
                <th className="px-6 py-5 text-[10px] font-black uppercase tracking-[0.2em] text-white/30">Status</th>
                <th className="px-6 py-5 text-right text-[10px] font-black uppercase tracking-[0.2em] text-white/30">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              <AnimatePresence mode="popLayout">
                {filteredDocs.map((doc) => (
                  <motion.tr 
                    key={doc.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0, x: -20 }}
                    className="group hover:bg-white/[0.01] transition-colors"
                  >
                    <td className="px-6 py-5">
                      <div className="flex items-center gap-4">
                        <div className="h-10 w-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                          <FileText className="h-5 w-5 text-primary" />
                        </div>
                        <span className="text-sm font-bold text-white tracking-tight truncate max-w-[200px]">
                          {doc.original_filename}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-5">
                      <span className="text-[10px] font-mono text-white/20 group-hover:text-white/40 transition-colors uppercase">
                        {doc.id.split('-')[0]}...
                      </span>
                    </td>
                    <td className="px-6 py-5">
                      <span className="text-xs font-bold text-white/30">
                        {doc.uploaded_at ? new Date(doc.uploaded_at).toLocaleDateString() : 'N/A'}
                      </span>
                    </td>
                    <td className="px-6 py-5">
                      <StatusIndicator status={doc.status} />
                    </td>
                    <td className="px-6 py-5 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <a 
                          href={doc.public_url} 
                          target="_blank" 
                          rel="noreferrer"
                          className="h-9 w-9 flex items-center justify-center rounded-lg hover:bg-white/5 text-white/20 hover:text-white transition-all"
                        >
                          <ExternalLink className="h-4 w-4" />
                        </a>
                        <button 
                          onClick={() => handleDeleteClick(doc.id)}
                          className="h-9 w-9 flex items-center justify-center rounded-lg hover:bg-red-500/10 text-white/20 hover:text-red-500 transition-all"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </motion.tr>
                ))}
              </AnimatePresence>
            </tbody>
          </table>
        </div>
        
        {!loading && filteredDocs.length === 0 && (
          <div className="p-20 text-center">
            <div className="h-16 w-16 rounded-full bg-white/5 flex items-center justify-center mx-auto mb-6">
              <FileText className="h-6 w-6 text-white/20" />
            </div>
            <h3 className="text-lg font-bold text-white">No documents found</h3>
            <p className="text-sm text-white/20 mt-1 uppercase tracking-widest font-black">Try a different search query or upload a file.</p>
          </div>
        )}
      </div>

      <DeleteConfirmModal 
        isOpen={deleteModalOpen}
        onClose={() => !deleting && setDeleteModalOpen(false)}
        onConfirm={confirmDelete}
        loading={deleting}
      />
    </div>
  );
}
