/**
 * JSX typings for the Illinois Web Toolkit v3 custom elements
 * (https://cdn.toolkit.illinois.edu/3/toolkit.js), loaded in `app/layout.tsx`.
 * Only the elements this app renders are declared.
 */
import type { DetailedHTMLProps, HTMLAttributes } from 'react';

type IlwElementProps<Attrs = object> = DetailedHTMLProps<
  HTMLAttributes<HTMLElement>,
  HTMLElement
> &
  Attrs;

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'ilw-header': IlwElementProps<{ compact?: boolean; source?: string }>;
      'ilw-header-menu': IlwElementProps;
      'ilw-footer': IlwElementProps<{ source?: string }>;
    }
  }
}
