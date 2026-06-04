'use client';

import { useEffect } from 'react';
import dynamic from 'next/dynamic';
import { useTerminal } from './TerminalProvider';
import type { TerminalPanelProps } from './types';

// xterm は window 依存のため SSR 無効化
const TerminalPanelInner = dynamic(() => import('./TerminalPanelInner'), { ssr: false });

export default function TerminalPanel(props: TerminalPanelProps) {
  const { toggle } = useTerminal();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Ctrl+` （macOS では Control+Backquote）でトグル
      if (e.ctrlKey && !e.metaKey && !e.altKey && e.key === '`') {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle]);

  return <TerminalPanelInner {...props} />;
}
