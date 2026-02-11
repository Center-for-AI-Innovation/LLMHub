'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { useModelSelector } from '@/hooks/use-model-selector';
import { CheckCircleFillIcon, ChevronDownIcon } from './icons';
import { useChatModels } from '@/hooks/use-models';

export function ModelSelector({
  className,
}: React.ComponentProps<typeof Button>) {
  const [open, setOpen] = useState(false);
  const { selectedModel, setSelectedModel } = useModelSelector();
  const { data: chatModels = [] } = useChatModels();

  const selectedChatModel = chatModels.find((chatModel) => chatModel.id === selectedModel);

  const handleModelSelect = (id: string) => {
    setOpen(false);
    setSelectedModel(id);
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        asChild
        className={cn(
          'w-fit data-[state=open]:bg-accent data-[state=open]:text-accent-foreground',
          className,
        )}
      >
        <Button variant="outline" className="md:h-[34px] md:px-2 bg-background dark:bg-muted/50 border-0 shadow-[0_2px_6px_rgba(0,0,0,0.05)] dark:shadow-[0_2px_6px_rgba(0,0,0,0.25)] dark:hover:bg-muted">
          {selectedChatModel?.name || 'Select model'}
          <ChevronDownIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[300px] shadow-lg">
        {chatModels.map((chatModel) => {
          const { id } = chatModel;

          return (
            <DropdownMenuItem
              key={id}
              onSelect={() => handleModelSelect(id)}
              className="gap-4 group/item flex flex-row justify-between items-center"
              data-active={id === selectedModel}
            >
              <div className="flex flex-col gap-1 items-start">
                <div>{chatModel.name}</div>
                <div className="text-xs text-muted-foreground">
                  {chatModel.description}
                </div>
              </div>

              <div className="text-foreground dark:text-foreground opacity-0 group-data-[active=true]/item:opacity-100">
                <CheckCircleFillIcon />
              </div>
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild className="cursor-pointer font-medium">
          <Link href="/dashboard">Request Model</Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
