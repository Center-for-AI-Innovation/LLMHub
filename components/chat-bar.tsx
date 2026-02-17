'use client';

import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useRouter } from 'next/navigation';
import type { FormEvent } from 'react';

export function ChatBar() {
  const router = useRouter();

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const query = formData.get('query') as string;
    
    // Use the existing /chat route which handles chat creation properly
    if (!query?.trim()) {
      router.push('/chat');
    } else {
      // If there's a query, pass it as a search param
      router.push(`/chat?query=${encodeURIComponent(query)}`);
    }
  };

  return (
    <div className="relative w-full max-w-3xl mx-auto">
      {/* Single bold light streak */}
      <div className="absolute -inset-x-full top-[35%] -translate-y-1/2">
        <div className="w-full h-2 bg-gradient-to-r from-transparent via-secondary to-transparent blur-md" />
        <div className="absolute inset-0 w-full h-4 bg-gradient-to-r from-transparent via-primary to-transparent blur-xl" />
      </div>
      {/* Chat should be enabled only when user is logged in and from Model Deployment Page */}
      <form 
        onSubmit={handleSubmit}
        className="relative flex items-center gap-2 p-2 rounded-full bg-background/80 backdrop-blur-xl border border-primary/10 shadow-xl"
      >
        <div className="flex-1 flex items-center gap-3 px-4">
          <Search className="size-5 text-muted-foreground" />
          <input
            type="text"
            name="query"
            placeholder="Start chatting with our supercomputer-powered AI..."
            className="flex-1 bg-transparent border-none outline-none text-lg placeholder:text-muted-foreground/50"
          />
        </div>
        <Button type="submit" size="lg" className="rounded-full h-12 px-6 bg-secondary hover:bg-secondary/90">
          Start Chatting
        </Button>
      </form>
      <p className="mt-4 text-sm text-center text-muted-foreground">
        Powered by NCSA&apos;s supercomputers for lightning-fast responses
      </p>
    </div>
  );
} 