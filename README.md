<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<title>@cli-web-terminal/react</title>
</head>
<body>

<h1>@cli-web-terminal/react</h1>

<p>
ブラウザに「claude code を spawn する PTY ターミナルパネル」を埋め込むための React コンポーネント。<code>xterm.js</code> を SSR 無効で組み込み、WebSocket でサーバ側 PTY ブリッジと繋ぐ。IME 中間入力の漏洩防止・高さドラッグ・タブ離脱ガード・Ctrl+` でのトグル等を内包する。
</p>

<p>
サーバ側 PTY と token endpoint は本パッケージのスコープ外。<code>@cli-web-terminal/server</code> (予定) もしくは利用者が自前で組み込む。
</p>

<h2>使い方</h2>

<pre><code>// app/layout.tsx 相当
import { TerminalProvider, TerminalPanel } from '@cli-web-terminal/react';

export default function Layout({ children }) {
  return (
    &lt;TerminalProvider&gt;
      {children}
      &lt;TerminalPanel
        basePath="/req-web"
        wsQueryParams={{ project: 'demo' }}
      /&gt;
    &lt;/TerminalProvider&gt;
  );
}
</code></pre>

<h2>Props</h2>

<table>
  <thead>
    <tr><th>prop</th><th>default</th><th>説明</th></tr>
  </thead>
  <tbody>
    <tr><td><code>basePath</code></td><td><code>''</code></td><td>fetch / WebSocket URL の先頭に付くパス。Next.js basePath 配下なら必須</td></tr>
    <tr><td><code>wsQueryParams</code></td><td><code>{}</code></td><td>WS 接続時に付ける query。pty bridge 側で参照する</td></tr>
    <tr><td><code>tokenEndpoint</code></td><td><code>/api/term/token</code></td><td>token 発行 POST endpoint。basePath が前置される</td></tr>
    <tr><td><code>wsEndpoint</code></td><td><code>/api/term</code></td><td>WS endpoint。basePath が前置される</td></tr>
    <tr><td><code>storageKeyPrefix</code></td><td><code>claude-terminal</code></td><td>localStorage キーの prefix。アプリ別に分けたいときに変える</td></tr>
    <tr><td><code>title</code></td><td><code>ターミナル</code></td><td>パネルバー左に表示するタイトル</td></tr>
    <tr><td><code>shortcutLabel</code></td><td><code>Ctrl+`</code></td><td>パネルバー右の <code>&lt;kbd&gt;</code> 表示文字列</td></tr>
  </tbody>
</table>

<h2>useTerminal フック</h2>

<p>
TerminalProvider 配下なら任意の component から <code>useTerminal()</code> で以下が取れる:
</p>

<ul>
  <li><code>isOpen / setOpen / toggle</code> — パネル開閉</li>
  <li><code>sendToTerminal(text)</code> — claude プロンプトにテキストを送り込む (Enter は付けない)</li>
  <li><code>registerSink(fn)</code> — TerminalPanel 側がテキスト受口を購読する内部 API</li>
</ul>

<p>
Provider が無いとノーオペ実装が返るので、Terminal を無効化した環境でも UI を壊さない。
</p>

<h2>peerDependencies</h2>

<ul>
  <li><code>@xterm/xterm</code>, <code>@xterm/addon-fit</code>, <code>@xterm/addon-web-links</code></li>
  <li><code>react</code>, <code>react-dom</code> (18 or 19)</li>
  <li><code>next</code> (<code>next/dynamic</code> を使って SSR 無効化しているため)</li>
</ul>

<p>
本パッケージは TypeScript ソースをそのまま <code>main</code> に指している。利用者の Next.js プロジェクトでは <code>next.config.ts</code> の <code>transpilePackages</code> に <code>'@cli-web-terminal/react'</code> を追加する必要がある。
</p>

<h2>CSS</h2>

<p>
パネルのレイアウトは利用者側 CSS で書く前提（クラス名は <code>.term-panel</code>, <code>.term-bar</code>, <code>.term-resizer</code>, <code>.term-body</code>, <code>.term-dot</code>, <code>.term-title</code>, <code>.term-status</code>, <code>.term-spacer</code>, <code>.term-kbd</code>, <code>.term-toggle</code>）。CSS 変数 <code>--term-height</code> で高さが管理される。
</p>

<p>
xterm 標準の CSS (<code>@xterm/xterm/css/xterm.css</code>) は内部で import 済み。
</p>

<h2>IME（日本語入力）の取り扱い</h2>

<p>
日本語確定文字は <code>textarea</code> の <code>compositionstart / compositionupdate / compositionend</code> を監視して扱う。
SKK のように <strong>compositionend 直後・同 tick で次の compositionstart が走る</strong>入力方式では、
xterm.js の CompositionHelper が「確定文字 + 次の composition の pre-edit の先頭部分」を 1 つの
<code>onData</code> にまとめて出してしまう（例: 「漏れ」→「が」で <code>"漏れg"</code>、「漢字」→ Shift+H で <code>"漢字▽"</code>）。
本コンポーネントは composition 進行中、<code>onData</code> データ末尾が現在の pre-edit の先頭部分と一致する分を
取り除いてから pty へ送る（実装・単体テストは <code>src/ime.ts</code> / <code>stripTrailingComposition</code>）。
取り除いた pre-edit は後続の <code>compositionend</code> で改めて確定文字として届くので失われない。
</p>

<h3>macSKK 利用時の必須設定（重要）</h3>

<p>
<strong>macSKK</strong> は既定では Web/ターミナル系アプリ（Chrome 上の本ターミナル含む）で
<strong>単独母音（あいうえお）やモード切替キー（<code>l</code> 等）を composition 経由で渡さず、生キーが素通りして漏れる</strong>。
これは macSKK 側の互換性挙動であり、ブラウザに「あ」自体が届かないため<strong>ターミナル側コードでは救済できない</strong>。
入力メニュー（対象アプリを最前面にした状態）で次の互換性設定を<strong>両方 ON</strong> にすること:
</p>

<ul>
  <li><strong>空文字挿入 (互換性)</strong> — composition を維持できないアプリ向けに空文字を挿入し、強制的に composition を張らせる（macSKK v0.20.0 では Kitty/Alacritty/LINE に対し既定 ON。Chrome は対象外なので手動で ON が必要）。</li>
  <li><strong>1文字目を未確定扱い (互換性)</strong> — <code>aiueo</code> のようなローマ字 1 文字のひらがな入力を composition 経由にする。</li>
</ul>

<p>
標準の macOS 日本語入力 / Google 日本語入力では composition が正常に発火するため、これらの設定は不要。
</p>

</body>
</html>
