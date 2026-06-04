export type TerminalPanelProps = {
  /**
   * fetch / WebSocket URL の先頭に付ける basePath。
   * Next.js の `basePath: '/req-web'` 配下に置く場合は '/req-web' を渡す。
   * fetch は basePath を自動付与しないので明示が必要。
   * @default ''
   */
  basePath?: string;

  /**
   * WebSocket 接続時に query parameter として付ける任意の key/value。
   * 認可・ルーティングのために pty bridge 側で参照する。
   * 例: `{ project: 'demo' }` → `?token=...&project=demo`
   */
  wsQueryParams?: Record<string, string>;

  /**
   * token 発行エンドポイントへの POST path。basePath は内部で前置される。
   * @default '/api/term/token'
   */
  tokenEndpoint?: string;

  /**
   * WebSocket エンドポイントの path。basePath は内部で前置される。
   * @default '/api/term'
   */
  wsEndpoint?: string;

  /**
   * localStorage キーのプレフィックス。複数アプリで衝突を避けるために変える。
   * 高さは `${storageKeyPrefix}:term-height` に保存される。
   * @default 'claude-terminal'
   */
  storageKeyPrefix?: string;

  /**
   * パネルバーに表示するタイトル文字列。
   * @default 'ターミナル'
   */
  title?: string;

  /**
   * パネルバーの右端 <kbd> に表示するショートカット表示。
   * @default 'Ctrl+`'
   */
  shortcutLabel?: string;
};
