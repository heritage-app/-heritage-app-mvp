"use client";

import { useForm } from "react-hook-form";
import { useUploadStore } from "@/store/uploadStore";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useRef, useState } from "react";
import { Upload, File, X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_TYPES = ["application/pdf"];

export function DocumentUpload() {
  const { uploadFile, isUploading, uploadProgress, error, resetUpload } =
    useUploadStore();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

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
      setSelectedFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      // Optionally redirect to conversations
      setTimeout(() => {
        router.push("/conversations");
      }, 1000);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload failed");
    }
  };

  return (
    <div className="flex h-full flex-col items-center justify-center p-8">
      <Card className="w-full max-w-2xl p-8">
        <h2 className="mb-6 text-2xl font-semibold">Upload Learning Material</h2>

        <div
          className={cn(
            "relative mb-4 flex min-h-[200px] flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 transition-colors",
            dragActive
              ? "border-primary bg-primary/5"
              : "border-muted-foreground/25 hover:border-primary/50",
            selectedFile && "border-primary bg-primary/5"
          )}
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,application/pdf"
            onChange={handleFileInputChange}
            className="hidden"
          />

          {selectedFile ? (
            <div className="flex flex-col items-center gap-4">
              <File className="h-12 w-12 text-primary" />
              <div className="text-center">
                <p className="font-medium">{selectedFile.name}</p>
                <p className="text-sm text-muted-foreground">
                  {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSelectedFile(null);
                  if (fileInputRef.current) {
                    fileInputRef.current.value = "";
                  }
                }}
              >
                <X className="mr-2 h-4 w-4" />
                Remove
              </Button>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-4 text-center">
              <Upload className="h-12 w-12 text-muted-foreground" />
              <div>
                <p className="font-medium">
                  Drag and drop your document here, or{" "}
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="text-primary hover:underline"
                  >
                    browse
                  </button>
                </p>
                <p className="mt-2 text-sm text-muted-foreground">
                  PDF files only (max 10MB)
                </p>
              </div>
            </div>
          )}
        </div>

        {isUploading && (
          <div className="mb-4">
            <div className="mb-2 flex justify-between text-sm">
              <span>Uploading...</span>
              <span>{uploadProgress}%</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
          </div>
        )}

        {error && (
          <div className="mb-4 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <div className="flex gap-4">
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
                Upload Material
              </>
            )}
          </Button>
        </div>
      </Card>
    </div>
  );
}


