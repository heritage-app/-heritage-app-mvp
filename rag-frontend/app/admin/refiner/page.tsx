"use client";

import { useState, useRef } from "react";
import { 
  FileJson, 
  UploadCloud, 
  BookOpen, 
  Loader2, 
  ArrowRight, 
  CheckCircle2, 
  Database, 
  FileText, 
  AlertTriangle,
  History,
  Info
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { apiClient } from "@/lib/api/client";
import { RefinementPreviewModal } from "@/components/admin/RefinementPreviewModal";

export default function BibleRefinerTool() {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [stagedData, setStagedData] = useState<any>(null);
  const [stagedFilename, setStagedFilename] = useState("");
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsAnalyzing(true);
    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await apiClient.post("/admin/refine/preview", formData, {
        headers: { "Content-Type": "multipart/form-data" }
      });

      if (res.refined_records?.length > 0) {
        setStagedData(res);
        setStagedFilename(file.name);
        setIsPreviewOpen(true);
      } else {
        toast.error("Low Verse Count: No Bible verses detected in this file.");
      }
    } catch (error: any) {
      console.error("Refinement failed:", error);
      toast.error(error.message || "Engine failed to parse file");
    } finally {
      setIsAnalyzing(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-12">
      {/* Tool Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div className="space-y-4">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/20">
            <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
            <span className="text-[10px] font-black uppercase tracking-widest text-primary">Stand-alone Tool</span>
          </div>
          <h1 className="text-5xl font-black text-white tracking-tighter">
            Bible <span className="text-primary italic">Lineage</span> Refiner
          </h1>
          <p className="text-white/40 font-medium max-w-xl text-lg leading-relaxed">
            Transform raw Ga/English Bible documents into high-fidelity archival records. 
            Automated chapter-alignment, numerical normalization, and persona validation.
          </p>
        </div>

        <div className="hidden lg:flex items-center gap-4 bg-white/[0.03] border border-white/5 p-6 rounded-3xl">
           <Info className="h-5 w-5 text-white/20" />
           <p className="text-[10px] font-bold text-white/30 uppercase tracking-widest leading-relaxed">
             Supported: PDF, DOCX, TXT<br />
             Multi-Chapter Segmenter Active
           </p>
        </div>
      </div>

      {/* Main Interaction Zone */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Upload Column */}
        <div className="lg:col-span-2">
          <motion.div 
            whileHover={{ scale: 0.995 }}
            className="group relative h-[450px] rounded-[40px] border-2 border-dashed border-white/5 bg-[#1c1c1c] hover:border-primary/50 hover:bg-primary/[0.02] transition-all flex flex-col items-center justify-center cursor-pointer overflow-hidden p-8"
            onClick={() => !isAnalyzing && fileInputRef.current?.click()}
          >
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(215,174,94,0.05),transparent)] opacity-0 group-hover:opacity-100 transition-opacity" />
            
            <input 
              type="file" 
              ref={fileInputRef} 
              onChange={handleFileChange} 
              className="hidden" 
              accept=".pdf,.docx,.txt"
            />

            <div className="relative z-10 flex flex-col items-center text-center">
              <div className="h-24 w-24 rounded-3xl bg-white/5 flex items-center justify-center mb-8 group-hover:bg-primary/10 group-hover:scale-110 transition-all border border-white/5 group-hover:border-primary/20">
                {isAnalyzing ? (
                  <Loader2 className="h-10 w-10 text-primary animate-spin" />
                ) : (
                  <UploadCloud className="h-10 w-10 text-white/20 group-hover:text-primary" />
                )}
              </div>
              
              <h3 className="text-2xl font-black text-white tracking-tight mb-2">
                {isAnalyzing ? "Analyzing Archival Patterns..." : "Drop Bible Source File"}
              </h3>
              <p className="text-white/20 font-bold uppercase tracking-widest text-[10px]">
                {isAnalyzing ? "Segmenting multi-chapter headers and aligning verses" : "PDF, DOCX, or Raw TXT (Max 50MB)"}
              </p>
            </div>

            <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-8 opacity-40 group-hover:opacity-100 transition-opacity">
               <FileText className="h-5 w-5 text-white/20" />
               <ArrowRight className="h-3 w-3 text-white/10" />
               <FileJson className="h-5 w-5 text-primary" />
               <ArrowRight className="h-3 w-3 text-white/10" />
               <Database className="h-5 w-5 text-emerald-500" />
            </div>
          </motion.div>
        </div>

        {/* Sidebar Help/Info */}
        <div className="space-y-6">
          <div className="p-8 rounded-[35px] bg-[#1c1c1c] border border-white/5 space-y-6">
            <div className="flex items-center gap-3">
              <History className="h-4 w-4 text-primary" />
              <h4 className="text-[10px] font-black uppercase tracking-widest text-white/40">Tool Capabilities</h4>
            </div>
            
            <ul className="space-y-4">
              {[
                { title: "Numerical Engine", desc: "Auto-generates traditional Ga labels (Kuku ni ji...)" },
                { title: "Archival Cleaning", desc: "Strips web artifacts, footers, and noise" },
                { title: "Interleaved Alignment", desc: "Pairs Ga/English blocks across multiple chapters" },
                { title: "16-Field Export", desc: "Matches canonical Heritage Archive schema" }
              ].map((item, i) => (
                <li key={i} className="flex gap-4">
                  <div className="h-1.5 w-1.5 rounded-full bg-primary mt-1.5 shrink-0" />
                  <div>
                    <p className="text-xs font-bold text-white">{item.title}</p>
                    <p className="text-[10px] text-white/30 mt-0.5">{item.desc}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div className="p-8 rounded-[35px] bg-gradient-to-br from-[#1c1c1c] to-[#0d0d0d] border border-white/5 relative overflow-hidden group">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_120%,rgba(215,174,94,0.15),transparent)]" />
            <div className="relative z-10">
              <CheckCircle2 className="h-6 w-6 text-primary mb-6" />
              <h4 className="text-[10px] font-black uppercase tracking-widest text-white/30">Archival Guardrail</h4>
              <p className="text-xs font-bold text-white/80 mt-2 leading-relaxed">
                Nothing enters the Vector Store until you verify the conversion side-by-side. 
                Perfect for ensuring "The Verse Rule" is never broken.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Reusing Modal for now, but triggered only from here */}
      <RefinementPreviewModal 
        isOpen={isPreviewOpen}
        onClose={() => setIsPreviewOpen(false)}
        data={stagedData}
        filename={stagedFilename}
        onComplete={() => {
          toast.success("Archival sequence committed to library.");
          setIsPreviewOpen(false);
        }}
      />
    </div>
  );
}
