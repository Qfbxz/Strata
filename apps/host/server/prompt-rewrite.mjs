/**
 * E3 意图整理器（prompt rewriter）：把含糊的用户消息整理成主模型高效理解的请求。
 *
 * 防误解是硬约束（用户 2026-11-10 点名）：
 *   - 原文保底：重述与原话一起给主模型（wrapForMainModel），纠偏有据；
 *   - 实质歧义不猜：整理器回 AMBIGUOUS 时调用方把追问还给用户；
 *   - 上下文进料：最近几轮对话随行，短依赖消息（"继续"）靠上下文展开；
 *   - 只重述、不回答：整理器绝不代替主模型作答。
 *
 * The HTTP call is the caller's (the small model's /v1/chat/completions with
 * "model": "small"); this file is the prompt, the wire format and the parsing.
 */

export const REWRITE_SYSTEM = [
  '你把用户发给 AI 助手的消息整理成清晰、完整、不依赖上下文的请求（重述）。',
  '规则：',
  '- 结合最近的对话理解指代（"继续""修复"指什么），把它们展开成明确的话；',
  '- 保留用户的全部意图：不添加用户没说的要求，也不丢弃任何细节；',
  '- 只重述，不要回答请求本身，也不要执行它；',
  '- 若有无法从上下文消除的实质歧义，先给出你最可能的理解作重述，再另起一行输出 AMBIGUOUS: 一句向用户确认的追问；',
  '输出格式：',
  'REWRITE: <重述的完整请求>',
  '（仅在有歧义时另起一行）AMBIGUOUS: <追问>',
  '不要输出格式说明本身，也不要输出这些示例文字。',
].join('\n');

/** The messages for the rewriter call: the rules, the recent turns, then the raw message. */
export function rewriteMessages(history, message, windowSize = 4) {
  const window = Array.isArray(history) ? history.slice(-Math.max(1, windowSize)) : [];
  const turns = window.map(m => `${m.role === 'assistant' ? '助手' : '用户'}: ${typeof m.content === 'string' ? m.content : '(非文本内容)'}`);
  return [
    { role: 'system', content: REWRITE_SYSTEM },
    ...(turns.length
      ? [{
          role: 'user',
          content: `最近的对话：\n${turns.join('\n')}\n\n用户新消息：\n${String(message ?? '')}`,
        }]
      : [{ role: 'user', content: `用户新消息：\n${String(message ?? '')}` }]),
  ];
}

/** REWRITE:/AMBIGUOUS: markers anywhere in the text - the models like to prefix the AMBIGUOUS
 *  line with the format note itself ("（仅在有歧义时另起一行）AMBIGUOUS: …"), so anchoring at the
 *  line start loses the marker.  A bare answer is still a rewrite attempt. */
export function parseRewrite(text) {
  const raw = String(text ?? '').trim();
  if (!raw) return { rewritten: null, ambiguous: null };
  const amb = /AMBIGUOUS\s*[:：]\s*(.+)$/m.exec(raw);
  const ambiguous = amb ? amb[1].trim().replace(/^[（(].*?[)）]\s*/, '') : null;
  const rw = /REWRITE\s*[:：]\s*([\s\S]+?)(?=\n?\s*AMBIGUOUS\s*[:：]|$)/m.exec(raw);
  let rewritten = rw ? rw[1].trim() : null;
  if (rewritten) rewritten = rewritten.replace(/^[（(][^)）]*[)）]\s*/, '').trim();
  if (!rewritten && !ambiguous) rewritten = raw;   // a bare answer is still a rewrite attempt
  return { rewritten, ambiguous };
}

/** What the main model reads: the rewrite labelled beside the original, so it can correct a bad rewrite.
 *  A rewrite that equals the message, or a failed one, passes the message through untouched. */
export function wrapForMainModel(rewritten, original) {
  const original_ = String(original ?? '');
  if (!rewritten || rewritten === original_) return original_;
  return `[重述] ${rewritten}\n[原话] ${original_}`;
}
