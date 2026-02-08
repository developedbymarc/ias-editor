import { useRef, useCallback, useEffect } from "react";

type Fn<T extends any[] = any[]> = (...args: T) => void;

interface UseDebounceOptions {
  wait?: number;
  leading?: boolean;
  trailing?: boolean;
}

export default function useDebounce<T extends Fn>(
  fn: T,
  opts: UseDebounceOptions = {},
): (...args: Parameters<T>) => void {
  const { wait = 1000, leading = false, trailing = true } = opts;
  const fnRef = useRef<T>(fn);
  const timerRef = useRef<number | null>(null);
  const lastArgsRef = useRef<Parameters<T> | null>(null);
  const calledLeadingRef = useRef(false);

  useEffect(() => {
    fnRef.current = fn;
  }, [fn]);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  const invoke = useCallback(() => {
    if (lastArgsRef.current) {
      fnRef.current(...lastArgsRef.current);
      lastArgsRef.current = null;
    }
  }, []);

  const debounced = useCallback(
    (...args: Parameters<T>) => {
      lastArgsRef.current = args;

      if (timerRef.current !== null) {
        if (trailing) {
          clearTimeout(timerRef.current);
          timerRef.current = window.setTimeout(() => {
            calledLeadingRef.current = false;
            timerRef.current = null;
            if (trailing) invoke();
          }, wait) as unknown as number;
        }
        return;
      }

      if (leading) {
        if (!calledLeadingRef.current) {
          fnRef.current(...args);
          lastArgsRef.current = null;
          calledLeadingRef.current = true;
        }
        timerRef.current = window.setTimeout(() => {
          timerRef.current = null;
          calledLeadingRef.current = false;
          if (trailing && lastArgsRef.current) invoke();
        }, wait) as unknown as number;
      } else {
        timerRef.current = window.setTimeout(() => {
          timerRef.current = null;
          invoke();
        }, wait) as unknown as number;
      }
    },
    [wait, leading, trailing, invoke],
  );

  return debounced;
}
