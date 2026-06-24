import { create } from 'zustand';
import type { Document } from '@/lib/db/schema';

interface DocumentCacheState {
  documents: Record<string, Document[]>;
  addDocuments: (documentId: string, docs: Document[]) => void;
  getDocuments: (documentId: string) => Document[] | undefined;
  clearCache: () => void;
}

export const useDocumentCache = create<DocumentCacheState>((set, get) => ({
  documents: {},
  
  addDocuments: (documentId: string, docs: Document[]) => {
    set((state) => ({
      documents: {
        ...state.documents,
        [documentId]: docs
      }
    }));
  },
  
  getDocuments: (documentId: string) => {
    return get().documents[documentId];
  },
  
  clearCache: () => {
    set({ documents: {} });
  }
})); 