import { create } from "zustand";
import type { UploadResponse } from "@/types";
import { uploadDocument } from "@/lib/api/upload";

interface UploadState {
  isUploading: boolean;
  uploadProgress: number;
  uploadedFiles: UploadResponse[];
  error: string | null;
  uploadFile: (file: File, metadata?: Record<string, any>) => Promise<void>;
  resetUpload: () => void;
}

export const useUploadStore = create<UploadState>((set) => ({
  isUploading: false,
  uploadProgress: 0,
  uploadedFiles: [],
  error: null,

  uploadFile: async (file: File, metadata?: Record<string, any>) => {
    set({ isUploading: true, uploadProgress: 0, error: null });

    try {
      const response = await uploadDocument(file, {
        metadata,
        onProgress: (progress) => {
          set({ uploadProgress: progress });
        },
      });

      set((state) => ({
        uploadedFiles: [...state.uploadedFiles, response],
        isUploading: false,
        uploadProgress: 100,
      }));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Upload failed";
      set({
        error: errorMessage,
        isUploading: false,
        uploadProgress: 0,
      });
      throw error;
    }
  },

  resetUpload: () => {
    set({
      isUploading: false,
      uploadProgress: 0,
      error: null,
    });
  },
}));



