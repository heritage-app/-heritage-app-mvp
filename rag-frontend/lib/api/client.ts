import axios, { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from "axios";
import { getAnonymousId } from "@/lib/utils/anonymous-id";

// Note: we can't use @auth-helpers or @ssr server helpers in this client-side axios file easily
// We'll rely on supabase-js client if needed, or better, just allow the interceptor
// to call a helper that gets the session from the client-side supabase instance.

const API_URL = process.env.NEXT_PUBLIC_API_URL || "https://heritage-backend.ekowlabs.space/api/v1";

export const apiClient: AxiosInstance = axios.create({
  baseURL: API_URL,
  withCredentials: true,
  headers: {
    "Content-Type": "application/json",
  },
});

// Request interceptor for adding guest auth headers
apiClient.interceptors.request.use(
  async (config: InternalAxiosRequestConfig) => {
    // The browser natively handles HttpOnly cookies for real auth.
    // We only attach Anonymous ID for guest tracking interactions
    const anonId = getAnonymousId();
    if (anonId) {
      config.headers["X-Anonymous-ID"] = anonId;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor for error handling
apiClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    if (error.response) {
      // Server responded with error status
      const message =
        (error.response.data as { detail?: string | { msg: string }[] })?.detail ||
        error.message ||
        "An error occurred";
      
      // Handle FastAPI detail format (string vs list of errors)
      const errorMsg = typeof message === 'string' ? message : JSON.stringify(message);
      
      return Promise.reject(new Error(errorMsg));
    } else if (error.request) {
      // Request made but no response received
      return Promise.reject(new Error("Network error. Please check your connection."));
    } else {
      // Something else happened
      return Promise.reject(error);
    }
  }
);
