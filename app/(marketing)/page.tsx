'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Bot, Code2, Database, Lock, Github } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Navbar } from '@/components/navbar';
import { ChatBar } from '@/components/chat-bar';

// Floating element component for visual interest
const FloatingElement = ({ className }: { className?: string }) => (
  <div className={cn(
    "absolute w-24 h-24 rounded-xl bg-gradient-to-br from-secondary/30 to-primary/30 backdrop-blur-3xl",
    "animate-float transform rotate-12",
    className
  )} />
);

export default function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-background via-primary/5 to-background">
      <Navbar />
      
      {/* Hero Section */}
      <section className="relative flex flex-col items-center justify-center space-y-12 px-4 py-20 text-center overflow-hidden">
        {/* Floating elements */}
        <FloatingElement className="left-[10%] top-1/4" />
        <FloatingElement className="right-[15%] top-1/3 rotate-45" />
        <FloatingElement className="left-[20%] bottom-1/4 -rotate-12" />
        
        <div className="relative space-y-6 z-10">
          <div className="inline-block rounded-full bg-secondary/10 px-4 py-1.5 text-sm text-secondary ring-1 ring-inset ring-secondary/20 mb-4 backdrop-blur-sm">
            Now in Beta
          </div>
          <h1 className="text-5xl font-bold tracking-tight sm:text-6xl md:text-7xl lg:text-8xl bg-clip-text text-transparent bg-gradient-to-r from-primary via-secondary to-primary bg-gradient-size animate-gradient">
            AI for Illinois
          </h1>
          <p className="mx-auto max-w-[700px] text-xl text-muted-foreground sm:text-2xl leading-relaxed">
            Access and deploy state-of-the-art language models for your research and applications.
            Built for the UIUC community.
          </p>
        </div>

        <ChatBar />
      </section>

      {/* Features Section */}
      <section className="relative py-16">
        <div className="container mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
          <div className="grid gap-12 lg:grid-cols-2">
            {/* Integrity */}
            <div className="relative p-12 rounded-[2rem] bg-white/[0.02] dark:bg-white/[0.02] shadow-[0_2px_10px_rgba(0,0,0,0.08)] dark:shadow-[inset_0_1px_1px_rgba(255,255,255,0.1)] hover:shadow-[0_4px_20px_rgba(0,0,0,0.12)] dark:hover:shadow-[inset_0_1px_1px_rgba(255,255,255,0.15)] backdrop-blur-sm transition-all duration-300 hover:translate-y-[-2px] hover:bg-white/[0.05] dark:hover:bg-white/[0.03] group">
              <div className="flex gap-8">
                <div className="shrink-0">
                  <div className="size-16 transition-transform duration-300 group-hover:scale-105">
                    <Bot className="size-full text-orange-500" />
                  </div>
                </div>
                <div>
                  <h3 className="text-3xl font-bold">
                    Pre-configured Models
                    <div className="h-1 w-16 bg-orange-500 mt-2" />
                  </h3>
                  <p className="mt-6 text-lg text-muted-foreground leading-relaxed">
                    Access our collection of ready-to-use language models, including state-of-the-art (SOTA) models optimized for performance and efficiency
                  </p>
                </div>
              </div>
            </div>

            {/* Passion */}
            <div className="relative p-12 rounded-[2rem] bg-white/[0.02] dark:bg-white/[0.02] shadow-[0_2px_10px_rgba(0,0,0,0.08)] dark:shadow-[inset_0_1px_1px_rgba(255,255,255,0.1)] hover:shadow-[0_4px_20px_rgba(0,0,0,0.12)] dark:hover:shadow-[inset_0_1px_1px_rgba(255,255,255,0.15)] backdrop-blur-sm transition-all duration-300 hover:translate-y-[-2px] hover:bg-white/[0.05] dark:hover:bg-white/[0.03] group">
              <div className="flex gap-8">
                <div className="shrink-0">
                  <div className="size-16 transition-transform duration-300 group-hover:scale-105">
                    <Database className="size-full text-pink-500" />
                  </div>
                </div>
                <div>
                  <h3 className="text-3xl font-bold">
                    Custom Deployments
                    <div className="h-1 w-16 bg-pink-500 mt-2" />
                  </h3>
                  <p className="mt-6 text-lg text-muted-foreground leading-relaxed">
                    Request and deploy models tailored to your needs, with seamless integration of any model from Hugging Face&apos;s extensive ecosystem
                  </p>
                </div>
              </div>
            </div>

            {/* Ownership */}
            <div className="relative p-12 rounded-[2rem] bg-white/[0.02] dark:bg-white/[0.02] shadow-[0_2px_10px_rgba(0,0,0,0.08)] dark:shadow-[inset_0_1px_1px_rgba(255,255,255,0.1)] hover:shadow-[0_4px_20px_rgba(0,0,0,0.12)] dark:hover:shadow-[inset_0_1px_1px_rgba(255,255,255,0.15)] backdrop-blur-sm transition-all duration-300 hover:translate-y-[-2px] hover:bg-white/[0.05] dark:hover:bg-white/[0.03] group">
              <div className="flex gap-8">
                <div className="shrink-0">
                  <div className="size-16 transition-transform duration-300 group-hover:scale-105">
                    <Code2 className="size-full text-blue-500" />
                  </div>
                </div>
                <div>
                  <h3 className="text-3xl font-bold">
                    API Access
                    <div className="h-1 w-16 bg-blue-500 mt-2" />
                  </h3>
                  <p className="mt-6 text-lg text-muted-foreground leading-relaxed">
                    Integrate models into your applications via REST API with full OpenAI API compatibility for seamless migration
                  </p>
                </div>
              </div>
            </div>

            {/* Innovation */}
            <div className="relative p-12 rounded-[2rem] bg-white/[0.02] dark:bg-white/[0.02] shadow-[0_2px_10px_rgba(0,0,0,0.08)] dark:shadow-[inset_0_1px_1px_rgba(255,255,255,0.1)] hover:shadow-[0_4px_20px_rgba(0,0,0,0.12)] dark:hover:shadow-[inset_0_1px_1px_rgba(255,255,255,0.15)] backdrop-blur-sm transition-all duration-300 hover:translate-y-[-2px] hover:bg-white/[0.05] dark:hover:bg-white/[0.03] group">
              <div className="flex gap-8">
                <div className="shrink-0">
                  <div className="size-16 transition-transform duration-300 group-hover:scale-105">
                    <Lock className="size-full text-yellow-500" />
                  </div>
                </div>
                <div>
                  <h3 className="text-3xl font-bold">
                    Secure & Private
                    <div className="h-1 w-16 bg-yellow-500 mt-2" />
                  </h3>
                  <p className="mt-6 text-lg text-muted-foreground leading-relaxed">
                    Enterprise-grade security for your data and models, powered by NCSA&apos;s state-of-the-art supercomputing infrastructure
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="relative py-20">
        <div className="container mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col items-center space-y-6 text-center">
            <h2 className="text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl bg-clip-text text-transparent bg-gradient-to-r from-primary to-secondary">
              Ready to Get Started?
            </h2>
            <p className="max-w-[600px] text-xl text-muted-foreground">
              Join the UIUC research community in leveraging state-of-the-art language models
              for your projects.
            </p>
            <Link href="/dashboard">
              <Button size="lg" className="mt-6 bg-secondary hover:bg-secondary/90 h-14 px-8 text-lg rounded-full">
                Request Your Model Now
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-primary/10 bg-background/50 backdrop-blur-sm py-8 mt-auto">
        <div className="container flex flex-col items-center justify-between gap-4 px-4 text-center md:flex-row md:text-left">
          <p className="text-sm text-muted-foreground">
            © 2026 LLM Hub. All rights reserved.
          </p>
          <div className="flex items-center space-x-6">
            <Link href="https://github.com/uiuc-llm" className="text-muted-foreground hover:text-primary transition-colors">
              <Github className="size-5" />
            </Link>
            <Link href="/privacy" className="text-sm text-muted-foreground hover:text-primary transition-colors">
              Privacy Policy
            </Link>
            <Link href="/terms" className="text-sm text-muted-foreground hover:text-primary transition-colors">
              Terms of Service
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
} 
