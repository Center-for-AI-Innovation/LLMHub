'use client';

import type { ComponentPropsWithoutRef } from 'react';

type CodeBlockProps = ComponentPropsWithoutRef<'code'> & {
  node?: unknown;
  inline?: boolean;
};

export function CodeBlock({
  node,
  inline = false,
  className = '',
  children,
  ...props
}: CodeBlockProps) {
  if (!inline) {
    return (
      <div className="not-prose flex flex-col">
        <pre
          {...props}
          className="text-sm w-full overflow-x-auto bg-muted p-4 border border-border rounded-xl text-foreground"
        >
          <code className="whitespace-pre-wrap break-words">{children}</code>
        </pre>
      </div>
    );
  } else {
    return (
      <code
        className={`${className} text-sm bg-muted py-0.5 px-1 rounded-md`}
        {...props}
      >
        {children}
      </code>
    );
  }
}
