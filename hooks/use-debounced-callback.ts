'use client';

import { useEffect, useRef, useState } from 'react';

export function useDebouncedCallback<T extends (...args: any[]) => void>(
  callback: T,
  delayMs: number,
) {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callbackRef = useRef(callback);
  const delayMsRef = useRef(delayMs);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    delayMsRef.current = delayMs;
  }, [delayMs]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const [debounced] = useState<(...args: Parameters<T>) => void>(() => {
    return (...args: Parameters<T>) => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      timeoutRef.current = setTimeout(() => {
        callbackRef.current(...args);
      }, delayMsRef.current);
    };
  });

  return debounced;
}
