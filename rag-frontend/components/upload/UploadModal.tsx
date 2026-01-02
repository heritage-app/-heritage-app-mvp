"use client";

import { useState, useRef } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Upload, File, X, Loader2 } from "lucide-react";
import { useUploadStore } from "@/store/uploadStore";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_TYPES = ["application/pdf"];

interface UploadModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onFileSelect: (file: File) => void;
}

export function UploadModal({ open, onOpenChange, onFileSelect }: UploadModalProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { uploadFile, isUploading, uploadProgress, error, resetUpload } = useUploadStore();

  const handleFileSelect = (file: File) => {
    // Validate file type - only PDF allowed
    if (!ALLOWED_TYPES.includes(file.type)) {
      toast.error("Invalid file type. Please upload a PDF file.");
      return;
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      toast.error("File size exceeds 10MB limit.");
      return;
    }

    setSelectedFile(file);
    resetUpload();
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelect(e.dataTransfer.files[0]);
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleFileSelect(e.target.files[0]);
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) return;

    try {
      await uploadFile(selectedFile);
      toast.success("Learning material uploaded successfully!");
      onFileSelect(selectedFile);
      setSelectedFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload failed");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-md sm:max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="text-lg sm:text-xl">Upload Learning Material</DialogTitle>
          <DialogDescription className="text-sm">
            Upload Ga language learning resources as PDF (max 10MB)
          </DialogDescription>
        </DialogHeader>
        
        <div
          className={cn(
            "relative flex min-h-[160px] flex-col items-center justify-center rounded-lg border-2 border-dashed p-4 transition-colors cursor-pointer sm:min-h-[200px] sm:p-6 md:p-8",
            dragActive
              ? "border-neutral-400 bg-neutral-50 dark:bg-neutral-800"
              : "border-neutral-200 hover:border-neutral-300 dark:border-neutral-700 dark:hover:border-neutral-600",
            selectedFile && "border-neutral-400 bg-neutral-50 dark:bg-neutral-800"
          )}
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,application/pdf"
            onChange={handleFileInputChange}
            className="hidden"
          />

          {selectedFile ? (
            <div className="flex flex-col items-center gap-3 sm:gap-4">
              <File className="h-10 w-10 text-neutral-600 dark:text-neutral-400 sm:h-12 sm:w-12" />
              <div className="text-center max-w-full px-2">
                <p className="font-medium text-sm text-neutral-900 dark:text-neutral-100 break-words sm:text-base">
                  {selectedFile.name}
                </p>
                <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400 sm:text-sm">
                  {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedFile(null);
                  if (fileInputRef.current) {
                    fileInputRef.current.value = "";
                  }
                }}
                className="text-xs sm:text-sm"
              >
                <X className="mr-2 h-3.5 w-3.5 sm:h-4 sm:w-4" />
                Remove
              </Button>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 text-center px-2 sm:gap-4">
              <Upload className="h-10 w-10 text-neutral-400 dark:text-neutral-500 sm:h-12 sm:w-12" />
              <div>
                <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100 sm:text-base">
                  Drag and drop your document here, or click to browse
                </p>
                <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400 sm:text-sm">
                  PDF files only (max 10MB)
                </p>
              </div>
            </div>
          )}
        </div>

        {isUploading && (
          <div className="space-y-2">
            <div className="flex justify-between text-sm text-neutral-600 dark:text-neutral-400">
              <span>Uploading...</span>
              <span>{uploadProgress}%</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700">
              <div
                className="h-full bg-neutral-900 dark:bg-neutral-100 transition-all"
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
          </div>
        )}

        {error && (
          <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
            {error}
          </div>
        )}

        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="flex-1"
          >
            Cancel
          </Button>
          <Button
            onClick={handleUpload}
            disabled={!selectedFile || isUploading}
            className="flex-1"
          >
            {isUploading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Uploading...
              </>
            ) : (
              <>
                <Upload className="mr-2 h-4 w-4" />
                Upload
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

