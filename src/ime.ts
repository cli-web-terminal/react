/**
 * SKK のように compositionend 直後・同 tick で次の compositionstart が走ると、
 * xterm.js の CompositionHelper は確定文字列の末尾に「次の composition の pre-edit
 * （ローマ字や SKK の ▽ 変換マーカー）の先頭部分」を連結した 1 つのイベントを onData に
 * 出してしまう。例:
 *   - 「漏れ」確定の直後に「が」を打ち始めると onData("漏れg")   （pre-edit "g" 全体）
 *   - 「漢字」確定の直後に Shift+H で変換を始めると onData("漢字▽") （pre-edit "▽h" の先頭 "▽" のみ）
 * まとめ出しされる末尾は「pre-edit 全体」とは限らず「pre-edit の先頭部分」なので、
 * 完全一致ではなく「data の末尾が compositionData の先頭と一致する最長部分」を取り除く。
 * 取り除いた pre-edit は後続の compositionend で改めて確定文字として届くので失われない。
 *
 * かな・漢字（確定文字）は非 ASCII、pre-edit はローマ字（ASCII）か ▽▼ マーカーなので、
 * 確定文字の末尾が pre-edit 先頭と一致するのは「まとめ出し」のケースに限られ、誤除去しにくい。
 *
 * @param data            xterm.js の onData が渡してきた文字列
 * @param composing       composition 進行中か（compositionstart〜compositionend の区間）
 * @param compositionData 現在の pre-edit 文字列（直近の compositionupdate の data）
 * @returns pty へ送るべき文字列（末尾の pre-edit 先頭部分を除いたもの）
 */
export function stripTrailingComposition(
  data: string,
  composing: boolean,
  compositionData: string,
): string {
  if (!composing || !compositionData) return data;
  // data の末尾が compositionData の先頭と一致する最長の長さ i を探して取り除く。
  const max = Math.min(data.length, compositionData.length);
  for (let i = max; i >= 1; i--) {
    if (data.slice(data.length - i) === compositionData.slice(0, i)) {
      return data.slice(0, data.length - i);
    }
  }
  return data;
}
