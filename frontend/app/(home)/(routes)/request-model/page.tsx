import type { Metadata } from 'next';
import { RequestModelForm } from '@/app/(home)/page-content/request-model-form';

export const metadata: Metadata = {
  title: 'Request a Model - UIUC LLM Service Platform',
  description: 'Request a custom language model deployment for your research or application.',
};

export default function RequestModelPage() {
  return (
    <div className="container mx-auto flex min-h-screen max-w-2xl flex-col px-4 py-16">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tighter sm:text-4xl md:text-5xl">
          Request a Model
        </h1>
        <p className="mt-4 text-lg text-muted-foreground">
          Fill out the form below to request a custom model deployment. We&apos;ll review your request
          and get back to you within 2 business days.
        </p>
      </div>
      <RequestModelForm />
    </div>
  );
} 