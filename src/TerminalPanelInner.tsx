'use client';

import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';

import { useTerminal } from './TerminalProvider';
import type { TerminalPanelProps } from './types';
import { stripTrailingComposition } from './ime';

type Status = 'idle' | 'connecting' | 'connected' | 'closed' | 'error';

const DEFAULT_TOKEN_ENDPOINT = '/api/term/token';
const DEFAULT_WS_ENDPOINT = '/api/term';
const DEFAULT_STORAGE_PREFIX = 'claude-terminal';

async function fetchToken(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { method: 'POST' });
    if (!res.ok) return null;
    const json = (await res.json()) as { token?: string };
    return typeof json.token === 'string' ? json.token : null;
  } catch {
    return null;
  }
}

export default function TerminalPanelInner({
  basePath = '',
  wsQueryParams,
  tokenEndpoint = DEFAULT_TOKEN_ENDPOINT,
  wsEndpoint = DEFAULT_WS_ENDPOINT,
  storageKeyPrefix = DEFAULT_STORAGE_PREFIX,
  title = 'ターミナル',
  shortcutLabel = 'Ctrl+`',
}: TerminalPanelProps) {
  const { isOpen, registerSink, toggle } = useTerminal();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const startedRef = useRef(false); // dev mode の二重 invoke / HMR 対策
  const [status, setStatus] = useState<Status>('idle');

  const heightStorageKey = `${storageKeyPrefix}:term-height`;
  const wsQueryStable = JSON.stringify(wsQueryParams ?? {});

  useEffect(() => {
    // 同コンポーネントのマウントで複数回 effect が走った場合（HMR 等）、最初の 1 回しか接続しない。
    if (startedRef.current) {
      return;
    }
    startedRef.current = true;
    const container = containerRef.current;
    if (!container) return;

    const term = new Terminal({
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: 13,
      theme: { background: '#0f172a', foreground: '#e2e8f0', cursor: '#facc15' },
      cursorBlink: true,
      convertEol: true,
      allowProposedApi: true,
      scrollback: 5000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(container);
    termRef.current = term;
    fitRef.current = fit;

    let alive = true;
    let ws: WebSocket | null = null;

    const sendResize = () => {
      const w = wsRef.current;
      if (!w || w.readyState !== WebSocket.OPEN) return;
      w.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
    };

    const tryFit = () => {
      try {
        fit.fit();
        sendResize();
      } catch {
        // container 高さ 0 など。次の resize で再試行。
      }
    };

    const ro = new ResizeObserver(() => tryFit());
    ro.observe(container);

    const connect = async () => {
      if (!alive) return;
      setStatus('connecting');
      const token = await fetchToken(`${basePath}${tokenEndpoint}`);
      if (!alive) return;
      if (!token) {
        setStatus('error');
        term.writeln('\x1b[31m[term] failed to get token (terminal disabled?)\x1b[0m');
        return;
      }
      const wsScheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const parsedParams = JSON.parse(wsQueryStable) as Record<string, string>;
      const params = new URLSearchParams({ token, ...parsedParams });
      const wsUrl = `${wsScheme}//${window.location.host}${basePath}${wsEndpoint}?${params.toString()}`;
      try {
        ws = new WebSocket(wsUrl);
        wsRef.current = ws;
      } catch {
        setStatus('error');
        return;
      }

      ws.onopen = () => {
        setStatus('connected');
        tryFit();
      };
      ws.onmessage = (ev) => {
        let msg: { type?: string; data?: string; code?: number } | null = null;
        try {
          msg = JSON.parse(typeof ev.data === 'string' ? ev.data : '');
        } catch {
          return;
        }
        if (!msg || typeof msg !== 'object') return;
        if (msg.type === 'output' && typeof msg.data === 'string') {
          term.write(msg.data);
        } else if (msg.type === 'exit') {
          term.writeln(`\r\n\x1b[33m[pty exited code=${msg.code ?? 0}]\x1b[0m`);
        }
      };
      ws.onclose = () => {
        if (!alive) return;
        setStatus('closed');
      };
      ws.onerror = () => {
        if (!alive) return;
        setStatus('error');
      };
    };

    const sendInput = (data: string) => {
      const w = wsRef.current;
      if (!w || w.readyState !== WebSocket.OPEN) return;
      w.send(JSON.stringify({ type: 'input', data }));
    };

    // IME（SKK 等）の composition 状態を追う。直近の pre-edit 文字列を握っておき、
    // xterm.js が「確定文字 + 次の composition の pre-edit」をまとめて onData に出した際に
    // 末尾の pre-edit を取り除けるようにする（詳細は ./ime.ts の stripTrailingComposition）。
    let composing = false;
    let compositionData = '';
    const textarea = term.textarea;
    const onCompStart = () => {
      composing = true;
    };
    const onCompUpdate = (e: Event) => {
      compositionData = (e as CompositionEvent).data ?? '';
    };
    const onCompEnd = () => {
      composing = false;
      compositionData = '';
    };
    textarea?.addEventListener('compositionstart', onCompStart);
    textarea?.addEventListener('compositionupdate', onCompUpdate);
    textarea?.addEventListener('compositionend', onCompEnd);

    const inputDisposable = term.onData((data) => {
      // SKK のように compositionend 直後・同 tick で次の composition が始まると、
      // xterm.js は「確定文字 + 次の composition の pre-edit の先頭部分」を 1 イベントに
      // まとめて出す（例: 「漏れ」→「が」で "漏れg"、「漢字」→ Shift+H で "漢字▽"）。
      // 末尾の pre-edit を取り除いてから送る（詳細は ./ime.ts）。
      const out = stripTrailingComposition(data, composing, compositionData);
      if (out) sendInput(out);
    });

    const unregister = registerSink((text) => {
      // ターミナルにテキストを「貼り付け」る（Enter は付けない）
      const w = wsRef.current;
      if (!w || w.readyState !== WebSocket.OPEN) return;
      w.send(JSON.stringify({ type: 'input', data: text }));
      term.focus();
    });

    // React 19 Strict Mode の即時 mount→unmount→mount を吸収するため、connect を 1 tick 遅らせる。
    // 1 回目の cleanup が同期的に走った後、2 回目の effect が動き始めてから接続が走る。
    const connectTimer = window.setTimeout(() => {
      if (alive) connect();
    }, 0);

    return () => {
      alive = false;
      window.clearTimeout(connectTimer);
      textarea?.removeEventListener('compositionstart', onCompStart);
      textarea?.removeEventListener('compositionupdate', onCompUpdate);
      textarea?.removeEventListener('compositionend', onCompEnd);
      ro.disconnect();
      inputDisposable.dispose();
      unregister();
      try {
        ws?.close();
      } catch {}
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      wsRef.current = null;
    };
  }, [basePath, tokenEndpoint, wsEndpoint, wsQueryStable, registerSink]);

  // パネルの開閉に追従して fit を呼ぶ。
  useEffect(() => {
    if (!isOpen) return;
    const id = window.setTimeout(() => {
      try {
        fitRef.current?.fit();
        const w = wsRef.current;
        const term = termRef.current;
        if (w && w.readyState === WebSocket.OPEN && term) {
          w.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
        }
      } catch {}
    }, 50);
    return () => window.clearTimeout(id);
  }, [isOpen]);

  // タブ / ウィンドウを閉じようとしたとき、ターミナルが開いていて WS が接続中なら
  // 「離れてもよいか」のネイティブダイアログを出す。closed 状態や接続が無いときは出さない。
  // ブラウザの仕様上、event.returnValue を立てるとモーダルが出る（メッセージはブラウザ側固定）。
  useEffect(() => {
    if (!isOpen) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      const w = wsRef.current;
      const live = w && (w.readyState === WebSocket.OPEN || w.readyState === WebSocket.CONNECTING);
      if (!live) return;
      e.preventDefault();
      // 旧仕様互換: returnValue を立てるとプロンプトが出るブラウザがある。
      e.returnValue = '';
      return '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [isOpen]);

  // 上端ハンドルでパネルの高さをドラッグ変更する。height は CSS 変数 --term-height で
  // 一元化し、localStorage に保存して再訪時に復元する。
  const MIN_HEIGHT = 120;
  const MAX_HEIGHT_RATIO = 0.85; // viewport の 85% を上限
  const [panelHeight, setPanelHeight] = useState<number>(() => {
    if (typeof window === 'undefined') return 280;
    const saved = Number(window.localStorage.getItem(heightStorageKey) || 0);
    if (saved >= MIN_HEIGHT && saved <= window.innerHeight * MAX_HEIGHT_RATIO) return saved;
    return 280;
  });
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    document.documentElement.style.setProperty('--term-height', `${panelHeight}px`);
    try {
      window.localStorage.setItem(heightStorageKey, String(panelHeight));
    } catch {}
    // 高さ変動後に xterm を fit
    const id = window.setTimeout(() => {
      try {
        fitRef.current?.fit();
        const w = wsRef.current;
        const term = termRef.current;
        if (w && w.readyState === WebSocket.OPEN && term) {
          w.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
        }
      } catch {}
    }, 0);
    return () => window.clearTimeout(id);
  }, [panelHeight, heightStorageKey]);

  const onResizerMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setDragging(true);
    document.body.classList.add('term-resizing');
    const startY = e.clientY;
    const startH = panelHeight;
    const max = window.innerHeight * MAX_HEIGHT_RATIO;
    const onMove = (ev: MouseEvent) => {
      const dy = ev.clientY - startY;
      const next = Math.max(MIN_HEIGHT, Math.min(max, startH - dy));
      setPanelHeight(next);
    };
    const onUp = () => {
      setDragging(false);
      document.body.classList.remove('term-resizing');
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <div className={'term-panel' + (isOpen ? ' open' : ' closed')}>
      {isOpen && (
        <div
          className={'term-resizer' + (dragging ? ' dragging' : '')}
          role="separator"
          aria-orientation="horizontal"
          aria-label="ターミナル高さリサイザ"
          onMouseDown={onResizerMouseDown}
          onDoubleClick={() => setPanelHeight(280)}
          title="ドラッグで高さ変更 / ダブルクリックで既定値"
        />
      )}
      <div className="term-bar">
        <span className={'term-dot status-' + status} />
        <span className="term-title">{title}</span>
        <span className="term-status">{status}</span>
        <span className="term-spacer" />
        <kbd className="term-kbd">{shortcutLabel}</kbd>
        <button type="button" className="term-toggle" onClick={() => toggle()}>
          {isOpen ? '▼ 閉じる' : '▲ 開く'}
        </button>
      </div>
      {isOpen && <div className="term-body" ref={containerRef} />}
    </div>
  );
}
