'use client';

import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

type SinkFn = (text: string) => void;

type TerminalApi = {
  isOpen: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
  sendToTerminal: (text: string) => void;
  registerSink: (fn: SinkFn) => () => void;
};

const TerminalContext = createContext<TerminalApi | null>(null);

export function useTerminal(): TerminalApi {
  const ctx = useContext(TerminalContext);
  if (ctx) return ctx;
  // Provider が無いとき（ターミナル無効環境）はノーオペ実装を返し、UI を壊さない。
  return {
    isOpen: false,
    setOpen: () => {},
    toggle: () => {},
    sendToTerminal: () => {},
    registerSink: () => () => {},
  };
}

export default function TerminalProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(true);
  const sinkRef = useRef<SinkFn | null>(null);
  const bufferRef = useRef<string[]>([]);

  const registerSink = useCallback((fn: SinkFn) => {
    sinkRef.current = fn;
    if (bufferRef.current.length > 0) {
      const flush = bufferRef.current.slice();
      bufferRef.current = [];
      for (const text of flush) fn(text);
    }
    return () => {
      if (sinkRef.current === fn) sinkRef.current = null;
    };
  }, []);

  const sendToTerminal = useCallback((text: string) => {
    if (typeof text !== 'string' || text.length === 0) return;
    setIsOpen(true);
    if (sinkRef.current) sinkRef.current(text);
    else {
      bufferRef.current.push(text);
      if (bufferRef.current.length > 16) bufferRef.current.shift();
    }
  }, []);

  const setOpen = useCallback((open: boolean) => setIsOpen(open), []);
  const toggle = useCallback(() => setIsOpen((v) => !v), []);

  const value = useMemo<TerminalApi>(
    () => ({ isOpen, setOpen, toggle, sendToTerminal, registerSink }),
    [isOpen, setOpen, toggle, sendToTerminal, registerSink],
  );

  return <TerminalContext.Provider value={value}>{children}</TerminalContext.Provider>;
}
