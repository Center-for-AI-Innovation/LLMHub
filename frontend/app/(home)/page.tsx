'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Github } from 'lucide-react';
import { Navbar } from '@/components/navbar';
import { ChatBar } from '@/components/chat-bar';

const FEATURES = [
  {
    index: '01',
    title: 'Pre-configured Models',
    body: 'Access our collection of ready-to-use language models, including state-of-the-art (SOTA) models optimized for performance and efficiency.',
  },
  {
    index: '02',
    title: 'Custom Deployments',
    body: "Request and deploy models tailored to your needs, with seamless integration of any model from Hugging Face\u2019s extensive ecosystem.",
  },
  {
    index: '03',
    title: 'API Access',
    body: 'Integrate models into your applications via REST API with full OpenAI API compatibility for seamless migration.',
  },
  {
    index: '04',
    title: 'Secure & Private',
    body: "Enterprise-grade security for your data and models, powered by NCSA\u2019s state-of-the-art supercomputing infrastructure.",
  },
] as const;


export default function LandingPage() {
  return (
    <div
      className="flex min-h-screen flex-col bg-background"
      style={{
        backgroundImage:
          'radial-gradient(circle, hsl(var(--primary) / 0.07) 1px, transparent 1px)',
        backgroundSize: '28px 28px',
      }}
    >
      <Navbar />

      {/* ── Hero ── */}
      <section className="container mx-auto max-w-6xl px-6 pt-20 pb-24 lg:pt-28 lg:pb-32">
        <div className="flex flex-col gap-8 max-w-3xl">
          {/* Eyebrow */}
          <div className="flex items-center gap-3">
            <div className="h-[2px] w-8 bg-secondary" />
            <span
              className="text-xs font-bold tracking-[0.2em] uppercase text-secondary"
              style={{ fontFamily: 'ui-monospace, "SFMono-Regular", Menlo, monospace' }}
            >
              Now in Beta
            </span>
          </div>

          {/* H1 */}
          <h1 className="font-display text-[clamp(4rem,10vw,8rem)] font-black leading-[0.9] tracking-tight text-primary">
            AI for
            <br />
            <span className="text-secondary">Illinois.</span>
          </h1>

          {/* Subheading */}
          <p className="max-w-lg text-lg text-muted-foreground leading-relaxed">
            Access and deploy state-of-the-art language models for your research
            and applications. Built for the UIUC community.
          </p>

          {/* Chat bar */}
          <div className="mt-2">
            <ChatBar />
          </div>
        </div>
      </section>

      {/* ── Capabilities ── */}
      <section className="border-t border-border">
        <div className="container mx-auto max-w-6xl px-6 py-20">

          {/* Section heading */}
          <h2 className="font-display text-5xl sm:text-6xl lg:text-7xl font-black text-foreground leading-none tracking-tight mb-16">
            Capabilities
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            {FEATURES.map(({ index, title, body }) => (
              <div
                key={index}
                className="group flex flex-col border border-border bg-background transition-all duration-300 hover:border-secondary/60 hover:bg-secondary/[0.03] dark:hover:bg-secondary/[0.05]"
              >
                {/* Orange top-bar — grows full-width on hover */}
                <div className="h-[3px] w-12 bg-secondary transition-all duration-500 group-hover:w-full" />

                <div className="flex flex-col gap-4 p-8 pt-7">
                  <h3 className="font-display text-2xl font-bold text-foreground leading-tight">
                    {title}
                  </h3>
                  <p className="text-base text-muted-foreground leading-relaxed">
                    {body}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="bg-primary">
        <div className="container mx-auto max-w-6xl px-6 py-20 lg:py-28">
          <div className="grid grid-cols-1 gap-10 lg:grid-cols-2 lg:gap-16 items-center">
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-3">
                <div className="h-[2px] w-8 bg-secondary" />
                {/* This section always sits on bg-primary, which itself
                    inverts between light/dark mode, so text-secondary (which
                    inverts the other way, in step with the page) ends up on
                    the wrong side of contrast in both themes. Pin the
                    lightness explicitly instead of following the theme. */}
                <span
                  className="text-xs font-bold tracking-[0.2em] uppercase text-[hsl(16_85%_58%)] dark:text-[hsl(16_90%_38%)]"
                  style={{ fontFamily: 'ui-monospace, "SFMono-Regular", Menlo, monospace' }}
                >
                  Get Started
                </span>
              </div>
              <h2 className="font-display text-4xl font-black leading-tight tracking-tight text-primary-foreground sm:text-5xl">
                Ready to build with state-of-the-art AI?
              </h2>
            </div>

            <div className="flex flex-col gap-6">
              <p className="text-lg text-primary-foreground/70 leading-relaxed">
                Join the UIUC research community in leveraging state-of-the-art language
                models for your projects.
              </p>
              <div>
                <Link href="/model-library" prefetch={false}>
                  <Button
                    size="lg"
                    className="bg-secondary hover:bg-secondary/90 text-secondary-foreground h-13 px-8 text-base font-semibold rounded-none"
                  >
                    Request Your Model
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-primary/10 bg-background py-8 mt-auto">
        <div className="container mx-auto max-w-6xl flex flex-col items-center justify-between gap-4 px-6 text-center md:flex-row md:text-left">
          <p
            className="text-xs text-muted-foreground"
            style={{ fontFamily: 'ui-monospace, "SFMono-Regular", Menlo, monospace' }}
          >
            © 2026 LLM Hub — University of Illinois
          </p>
          <div className="flex items-center gap-6">
            <Link
              href="https://github.com/uiuc-llm"
              className="text-muted-foreground hover:text-foreground transition-colors"
              aria-label="GitHub"
            >
              <Github className="size-4" />
            </Link>
            <Link href="/privacy" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
              Privacy Policy
            </Link>
            <Link href="/terms" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
              Terms of Service
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
