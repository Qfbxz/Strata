// E3 意图整理器质量评测集：20 条固定含糊消息 → 期望要点，防模型/提示词退化。
// 跑法：node ~/strata-setup/night/rewrite_eval.mjs   （sidecar 需在 127.0.0.1:4321）
import { rewriteMessages, parseRewrite } from '/Users/boergege/compile/优秀仓库参考/strata/apps/host/server/prompt-rewrite.mjs';

const URL_ = 'http://127.0.0.1:4321/v1/chat/completions';

const H = {
  night: [
    { role: 'user', content: '帮我看看 nightchain 的下载为什么卡住了' },
    { role: 'assistant', content: '查过了：final-debts.sh 的断点续传在进程被杀时会丢 .incomplete 分片，需要加校验恢复。' },
  ],
  skill: [
    { role: 'user', content: '技能批量导入加了，但嵌套目录扫不到 SKILL.md' },
    { role: 'assistant', content: '修好了：批量导入现在扫描任意深度的 SKILL.md，跳过 node_modules。' },
  ],
  perf: [
    { role: 'user', content: '512K 下 iq3_s 的 prefill 想到 1500 tok/s' },
    { role: 'assistant', content: '夜间矩阵会测 prefill auto:16384 与 KV k8v4 两臂，数据明早出。' },
  ],
};

// expect_contains: 重述必须包含的要点（小写包含判定）；ambiguous: 是否期望出现追问
const CASES = [
  { name: '继续-nightchain', history: H.night, msg: '继续', expect: ['final-debts', '断点', '恢复'], ambiguous: false },
  { name: '继续-性能', history: H.perf, msg: '继续', expect: ['prefill', '1500'], ambiguous: false },
  { name: '指代-那个问题', history: H.skill, msg: '那个问题修了吗', expect: ['skill', '扫'], ambiguous: false },
  { name: '指代-昨天的', history: H.perf, msg: '昨天那个测完了吗', expect: ['512k', 'prefill'], ambiguous: false },
  { name: '多步压缩', history: H.night, msg: '改好之后跑一遍测试再更新文档', expect: ['测试', '文档'], ambiguous: false },
  { name: '多步压缩-性能', history: H.perf, msg: '两个都改了就发我', expect: ['prefill', 'kv'], ambiguous: false },
  { name: '细节-路径', history: H.night, msg: '把那个脚本里超时改成 120 秒', expect: ['120', '脚本'], ambiguous: false },
  { name: '细节-数字', history: H.perf, msg: '目标改成 1200 吧', expect: ['1200'], ambiguous: false },
  { name: '真歧义-无宾语', history: [], msg: '帮我改一下', expect: [], ambiguous: true },
  { name: '真歧义-哪个文件', history: [], msg: '这个文件不对', expect: [], ambiguous: true },
  { name: '真歧义-两义', history: [], msg: '还是用之前那个吧', expect: [], ambiguous: true },
  { name: '中英混合', history: H.night, msg: 'resume 一下，timeout 那段重点看', expect: ['timeout', '断点'], ambiguous: false },
  { name: '口语冗余', history: [], msg: '就是说那个啥，能不能帮我把速度再弄快一点啊，现在太慢了', expect: ['速度', '快'], ambiguous: false },
  { name: '倒装', history: H.skill, msg: '文档先别动，只改代码', expect: ['代码', '文档'], ambiguous: false },
  { name: '否定+确认', history: H.skill, msg: '别跳过 node_modules，其他的照旧', expect: ['node_modules'], ambiguous: false },
  { name: '数量词', history: H.night, msg: '前三个臂重跑，后面的不用', expect: ['三', '臂'], ambiguous: false },
  { name: '条件', history: H.perf, msg: '如果夜测过了就提交，不过就再排一晚', expect: ['提交', '夜测'], ambiguous: false },
  { name: '长上下文指代', history: [...H.night, { role: 'assistant', content: '已加 .incomplete 校验，但 SHA 终验还没做。' }], msg: '把剩下那步也做了', expect: ['sha'], ambiguous: false },
  { name: '专业缩写', history: [], msg: 'ECD 那个模型参数再校一遍，用实测密度', expect: ['ecd', '密度'], ambiguous: false },
  { name: '清单指令', history: [], msg: '三件事：修超时、加日志、跑回归', expect: ['超时', '日志', '回归'], ambiguous: false },
];

async function one(c) {
  const body = { model: 'small', messages: rewriteMessages(c.history, c.msg), max_tokens: 400, temperature: 0 };
  const r = await fetch(URL_, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const d = await r.json();
  const out = parseRewrite(d.choices?.[0]?.message?.content ?? '');
  const lower = (out.rewritten ?? '').toLowerCase();
  const hits = c.expect.filter(k => lower.includes(k.toLowerCase()));
  const pass = (c.expect.length === 0 || hits.length === c.expect.length) && (!!out.ambiguous === c.ambiguous);
  return { name: c.name, pass, hits: `${hits.length}/${c.expect.length}`, ambiguous: !!out.ambiguous,
           expect_amb: c.ambiguous, rewritten: (out.rewritten ?? '').slice(0, 120),
           ask: (out.ambiguous ?? '').slice(0, 80) };
}

const results = [];
for (const c of CASES) { results.push(await one(c)); console.log(JSON.stringify(results.at(-1))); }
const ok = results.filter(r => r.pass).length;
console.log(`\nPASS ${ok}/${results.length}`);
const misses = results.filter(r => !r.pass).map(r => r.name);
if (misses.length) console.log('MISSES:', misses.join(', '));
