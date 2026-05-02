const { getDb } = require('../db');
const { updateStatus } = require('./status');
const { addNote } = require('./note');

const { BedrockRuntimeClient, ConverseCommand } = require('@aws-sdk/client-bedrock-runtime');

const BEDROCK_MODEL = process.env.FOE_BEDROCK_MODEL || 'qwen.qwen3-235b-a22b-2507-v1:0';
const BEDROCK_REGION = process.env.AWS_REGION || 'ap-northeast-1';
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.FOE_MODEL || 'gemma3:4b';
const USE_BEDROCK = (process.env.FOE_EXTRACTOR || 'bedrock') === 'bedrock';

/**
 * Build the list of active opportunities for context.
 */
function getActiveOpportunities() {
  const db = getDb();
  return db.prepare(`
    SELECT id, company_name, project_title, status, compensation, work_style, agent_name, agent_company
    FROM opportunities
    WHERE status NOT IN ('対象外', 'アンマッチ', '辞退', '成約')
    ORDER BY id
  `).all();
}

/**
 * Call LLM to parse free-text update into structured actions.
 */
async function parseUpdateText(text, opportunities) {
  const oppList = opportunities.map(o =>
    `  #${o.id}: ${o.company_name} - ${o.project_title}`
  ).join('\n');

  const systemPrompt = `あなたはフリーランス案件管理のアシスタントです。

ユーザーが複数の案件に対する判断（エントリーしたい、辞退したい、質問がある等）を自由文で入力します。
その内容を解析し、ユーザーが言及した案件のみ、変更アクションをJSON配列で返してください。

案件一覧（IDと企業名のマッピング）:
${oppList}

出力フォーマット（JSON配列）:
[
  {
    "id": 案件ID,
    "company_name": "企業名",
    "new_status": "エントリー済 or 辞退 or アンマッチ or 検討中 or 面談済 or 成約",
    "note": "ユーザーの判断理由やコメントの要約"
  }
]

判定ルール:
- 「エントリーしたい」「進めたい」「希望」 → new_status: "エントリー済"
- 「自分から辞退」「見送り」「パス」「辞退」 → new_status: "辞退"
- 「先方から応答なし」「一定期間応答がない」「音沙汰なし」「アンマッチ」「先方都合」 → new_status: "アンマッチ"
- 「検討中」「もう少し考える」 → new_status: "検討中"
- 質問や確認事項のみで判断が未定 → new_status: "検討中", noteに質問内容

重要:
- ユーザーが言及していない案件は配列に含めないこと
- 企業名の部分一致でIDをマッチすること
- noteにはユーザー自身のコメントや理由を簡潔にまとめること

JSON配列のみを返してください。`;

  const userMessage = text;

  let content;
  if (USE_BEDROCK) {
    try {
      const client = new BedrockRuntimeClient({ region: BEDROCK_REGION });
      const command = new ConverseCommand({
        modelId: BEDROCK_MODEL,
        system: [{ text: systemPrompt }],
        messages: [{ role: 'user', content: [{ text: userMessage }] }],
        inferenceConfig: { maxTokens: 4096, temperature: 0 },
      });
      const response = await client.send(command);
      content = response.output?.message?.content?.[0]?.text?.trim();
      if (process.env.FOE_DEBUG) console.log('(via Bedrock)');
    } catch (err) {
      console.error(`Bedrock failed, falling back to Ollama: ${err.message}`);
    }
  }

  if (!content) {
    const response = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        stream: false,
        options: { temperature: 0 },
        format: 'json',
      }),
    });
    if (!response.ok) throw new Error(`Ollama error: ${response.status}`);
    const data = await response.json();
    content = data.message?.content?.trim();
  }

  if (!content) return [];

  // Clean up: strip code fences and think blocks
  const cleaned = content
    .replace(/^```json?\s*/i, '').replace(/```\s*$/, '')
    .replace(/<think>[\s\S]*?<\/think>\s*/g, '')
    .trim();

  if (process.env.FOE_DEBUG) {
    console.log('LLM raw (before clean):', content.slice(0, 500));
    console.log('LLM raw (after clean):', cleaned.slice(0, 500));
  }
  const parsed = JSON.parse(cleaned);
  return Array.isArray(parsed) ? parsed : parsed.actions || [];
}

/**
 * foe update — parse free-text and apply bulk updates.
 */
async function update(text, options = {}) {
  if (!text || !text.trim()) {
    console.error('Usage: echo "返信テキスト" | foe update');
    console.error('       foe update "返信テキスト"');
    process.exit(1);
  }

  const opportunities = getActiveOpportunities();
  if (opportunities.length === 0) {
    console.log('アクティブな案件がありません。');
    return;
  }

  if (process.env.FOE_DEBUG) console.log('Input text:', text.slice(0, 200));
  console.log('解析中...\n');
  const actions = await parseUpdateText(text, opportunities);

  if (actions.length === 0) {
    console.log('更新対象の案件が見つかりませんでした。');
    return;
  }

  // Preview
  console.log(`${actions.length} 件のアクションを検出:\n`);
  for (const a of actions) {
    const opp = opportunities.find(o => o.id === a.id);
    const name = opp ? opp.company_name : a.company_name || '?';
    const status = a.new_status || a.status;
    const parts = [`#${a.id} ${name}`];
    if (status) parts.push(`→ ${status}`);
    if (a.note) parts.push(`📝 ${a.note.slice(0, 80)}`);
    console.log('  ' + parts.join('  '));
  }

  if (options.dryRun) {
    console.log('\n(dry-run: 変更は適用されていません)');
    return;
  }

  console.log('\n適用中...\n');

  // Apply
  const db = getDb();
  for (const a of actions) {
    const status = a.new_status || a.status;
    try {
      if (status) {
        updateStatus(a.id, status, a.note);
      } else if (a.note) {
        addNote(a.id, a.note);
      }
    } catch (err) {
      console.error(`  ⚠ #${a.id}: ${err.message}`);
    }
  }

  console.log('\n完了。');
}

module.exports = { update };
