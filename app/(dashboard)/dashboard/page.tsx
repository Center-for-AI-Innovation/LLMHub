'use client';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Bot, Cpu, Sparkles, Zap } from 'lucide-react';
import { RequestModelDialog } from '@/components/request-model-dialog';

// Mock data for available models
const availableModels = [
  {
    id: 1,
    name: 'GPT-4',
    description: 'Latest GPT-4 model for advanced language understanding and generation',
    status: 'WARM',
    type: 'Large',
    icon: Sparkles,
  },
  {
    id: 2,
    name: 'Claude 3',
    description: 'High-performance model optimized for academic research and analysis',
    status: 'WARM',
    type: 'Large',
    icon: Bot,
  },
  {
    id: 3,
    name: 'Llama 2',
    description: 'Open-source model suitable for various NLP tasks',
    status: 'WARM',
    type: 'Medium',
    icon: Cpu,
  },
  {
    id: 4,
    name: 'CodeLlama',
    description: 'Specialized model for code understanding and generation',
    status: 'WARM',
    type: 'Medium',
    icon: Zap,
  },
];

export default function DashboardPage() {
  return (
    <div className="container mx-auto p-6">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Model Catalog</h1>
          <p className="text-muted-foreground">
            Access pre-configured models or request custom deployments
          </p>
        </div>
        <RequestModelDialog />
      </div>

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {availableModels.map((model) => {
          const Icon = model.icon;
          return (
            <Card key={model.id} className="flex flex-col">
              <CardHeader>
                <div className="mb-2 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                  <Icon className="h-6 w-6 text-primary" />
                </div>
                <CardTitle className="flex items-center justify-between">
                  {model.name}
                  <span className="rounded-full bg-emerald-500/10 px-2 py-1 text-xs font-medium text-emerald-500">
                    {model.status}
                  </span>
                </CardTitle>
                <CardDescription>{model.description}</CardDescription>
              </CardHeader>
              <CardContent className="flex-1">
                <div className="text-sm text-muted-foreground">
                  <p>Type: {model.type}</p>
                </div>
              </CardContent>
              <CardFooter className="flex justify-between">
                <Button variant="outline" className="w-[48%]">
                  API Docs
                </Button>
                <Button className="w-[48%]">
                  Try Chat
                </Button>
              </CardFooter>
            </Card>
          );
        })}
      </div>
    </div>
  );
} 