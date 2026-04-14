const ANONYMOUS_ID_KEY = 'heritage_rag_anon_id';

/**
 * Retrieves the existing anonymous ID from localStorage or creates a new one.
 * Uses native crypto.randomUUID() to avoid dependencies.
 */
export const getAnonymousId = (): string => {
  if (typeof window === 'undefined') return '';

  let id = localStorage.getItem(ANONYMOUS_ID_KEY);
  
  if (!id) {
    // Generate a new UUID using the native web crypto API
    id = typeof crypto !== 'undefined' && crypto.randomUUID 
      ? crypto.randomUUID() 
      : Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    
    localStorage.setItem(ANONYMOUS_ID_KEY, id);
  }
  
  return id;
};

/**
 * Clears the anonymous ID
 */
export const clearAnonymousId = (): void => {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(ANONYMOUS_ID_KEY);
};
