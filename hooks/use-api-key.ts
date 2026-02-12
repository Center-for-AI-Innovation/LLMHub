import { useMutation } from '@tanstack/react-query';

export type ApiKeyResponse = {
  apiKey: string;
  expiresAt: string;
};

//  React Query Hook for generating a new API key using the /api/user/api-key route
export function useGenerateApiKey() {
  return useMutation({
    mutationFn: async (): Promise<ApiKeyResponse> => {
      const response = await fetch('/api/user/api-key', {
        method: 'POST',
      });

      if (!response.ok) {
        let errorMessage = 'Failed to generate API key';

        try {
          const errorBody = (await response.json()) as
            | { error?: string }
            | { error?: { message?: string } };
          if (typeof errorBody.error === 'string') {
            errorMessage = errorBody.error;
          } else if (errorBody.error?.message) {
            errorMessage = errorBody.error.message;
          }
        } catch (error) {
          const fallbackText = await response.text();
          errorMessage = fallbackText || errorMessage;
        }

        throw new Error(errorMessage);
      }

      return response.json();
    },
  });
}
