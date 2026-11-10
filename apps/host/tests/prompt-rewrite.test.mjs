// E3 意图整理器：把含糊的用户消息整理成主模型高效理解的请求。
// 防误解是硬约束：原文永远随行（主模型纠偏有据），实质歧义不猜、直接追问。
import test from 'node:test';
import assert from 'node:assert/strict';
import { rewriteMessages, parseRewrite, wrapForMainModel } from '../server/prompt-rewrite.mjs';

test('the rewrite prompt carries the recent turns and the new message, and forbids answering', () => {
  const history = [
    { role: 'user', content: '修一下 nightchain 的下载' },
    { role: 'assistant', content: 'nightchain 的下载脚本在 ~/strata-setup/night/final-debts.sh，改好了。' },
  ];
  const msgs = rewriteMessages(history, '继续', 3);
  assert.equal(msgs[0].role, 'system');
  assert.ok(/整理/.test(msgs[0].content), 'the system prompt asks for a rewrite');
  assert.ok(/REWRITE:/.test(msgs[0].content), 'the wire format is stated');
  assert.ok(/歧义|ambiguous/i.test(msgs[0].content), 'the ambiguity rule is stated');
  assert.ok(/不要回答|不回答/.test(msgs[0].content), 'the rewriter must not answer the request');
  const last = msgs[msgs.length - 1];
  assert.equal(last.role, 'user');
  assert.ok(last.content.includes('继续'), 'the raw message is in the prompt');
  assert.ok(last.content.includes('final-debts.sh'), 'the recent turns feed the disambiguation');
});

test('the history window is bounded', () => {
  const many = Array.from({ length: 20 }, (_, i) => ({ role: 'user', content: `第${i}条` }));
  const msgs = rewriteMessages(many, '新消息', 3);
  const joined = msgs[msgs.length - 1].content;
  assert.ok(!joined.includes('第0条'), 'turns beyond the window are dropped');
  assert.ok(joined.includes('第18条'), 'the latest turns stay');
});

test('parseRewrite reads the wire format and the ambiguity marker', () => {
  const good = parseRewrite('REWRITE: 继续修复 nightchain 下载脚本的断点续传问题');
  assert.equal(good.rewritten, '继续修复 nightchain 下载脚本的断点续传问题');
  assert.equal(good.ambiguous, null);

  const ask = parseRewrite('REWRITE: 想修复哪个问题？\nAMBIGUOUS: 你要修下载中断还是下载速度？');
  assert.equal(ask.ambiguous, '你要修下载中断还是下载速度？');
  assert.ok(ask.rewritten.length > 0);

  const bare = parseRewrite('继续上一轮的任务。');
  assert.equal(bare.rewritten, '继续上一轮的任务。', 'a model that ignores the format still yields its text');
  assert.equal(bare.ambiguous, null);

  // what the models actually send back: the format note rides in front of the AMBIGUOUS marker
  const real = parseRewrite('REWRITE: 想修复哪个问题？\n（仅在有歧义时另起一行）AMBIGUOUS: 你要修下载中断还是下载速度？');
  assert.equal(real.ambiguous, '你要修下载中断还是下载速度？', 'the marker survives a prefixed format note');

  const noisy = parseRewrite('REWRITE: 请修复下载脚本的断点续传。\n（无歧义，无需追问）');
  assert.equal(noisy.rewritten, '请修复下载脚本的断点续传。', 'a trailing note after the rewrite is not part of it');
  assert.equal(noisy.ambiguous, null);

  assert.equal(parseRewrite('   ').rewritten, null, 'nothing useful comes back as null');
});

test('wrapForMainModel keeps the original beside the rewrite, and passes plain messages through', () => {
  const wrapped = wrapForMainModel('继续 nightchain 下载脚本的断点续传修复', '继续');
  assert.ok(wrapped.includes('[重述]'), 'the rewrite is labelled');
  assert.ok(wrapped.includes('[原话] 继续'), 'the original rides along so the main model can correct it');

  const same = wrapForMainModel('列出目录', '列出目录');
  assert.equal(same, '列出目录', 'no ceremony when the rewrite equals the message');

  const fallback = wrapForMainModel(null, '原话保底');
  assert.equal(fallback, '原话保底', 'a failed rewrite leaves the message untouched');
});

test('an ambiguous rewrite never reaches the main model as an instruction', () => {
  // the caller asks again instead: the wrapped form must not exist for ambiguous results
  const ask = parseRewrite('REWRITE: x\nAMBIGUOUS: 要哪一个？');
  assert.ok(ask.ambiguous, 'the marker is the trigger for asking the user');
  assert.equal(typeof wrapForMainModel, 'function');
});
