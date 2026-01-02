import { apiClient } from "./client";
import type { UploadResponse } from "@/types";

export interface UploadOptions {
  metadata?: Record<string, any>;
  onProgress?: (progress: number) => void;
}

export async function uploadDocument(
  file: File,
  options: UploadOptions = {}
): Promise<UploadResponse> {
  const formData = new FormData();
  formData.append("file", file);

  if (options.metadata) {
    // Add metadata as query parameter or in form data
    Object.entries(options.metadata).forEach(([key, value]) => {
      formData.append(key, String(value));
    });
  }

  const response = await apiClient.post("/upload", formData, {
    headers: {
      "Content-Type": "multipart/form-data",
    },
    onUploadProgress: (progressEvent) => {
      if (progressEvent.total && options.onProgress) {
        const progress = Math.round(
          (progressEvent.loaded * 100) / progressEvent.total
        );
        options.onProgress(progress);
      }
    },
  });

  return response.data;
}



