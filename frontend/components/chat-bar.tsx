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
    
    if (!query?.trim()) {
      router.push('/chat');
    } else {
      router.push(`/chat?query=${encodeURIComponent(query)}`);
    }
  };

  return (
    <div className="relative w-full max-w-3xl mx-auto">
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
        <Button
          type="submit"
          variant="secondary"
          size="lg"
          className="rounded-full h-12 px-6"
        >
          Start Chatting
        </Button>
      </form>
      <p className="mt-4 text-sm text-center text-muted-foreground">
        Powered by NCSA&apos;s supercomputers for lightning-fast responses
      </p>
    </div>
  );
} 
