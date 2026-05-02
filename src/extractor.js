const { BedrockRuntimeClient, ConverseCommand } = require('@aws-sdk/client-bedrock-runtime');

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.FOE_MODEL || 'gemma3:4b';
const BEDROCK_MODEL = process.env.FOE_BEDROCK_MODEL || 'qwen.qwen3-235b-a22b-2507-v1:0';
const BEDROCK_REGION = process.env.AWS_REGION || 'ap-northeast-1';

// Use Bedrock for extraction by default; fall back to Ollama if FOE_EXTRACTOR=ollama
const USE_BEDROCK = (process.env.FOE_EXTRACTOR || 'bedrock') === 'bedrock';

function buildSystemPrompt() {
  return `あなたは日本語のフリーランス案件紹介メールから構造化データを抽出するアシスタントです。
メールの件名と本文を受け取り、JSON形式で返してください。
値が見つからないフィールドはnullにしてください。

まず、メールの種別を判定してください:
- email_type: 以下のいずれか
  - "opportunity": 具体的な案件紹介（企業名・業務内容・稼働条件などが記載されている）
  - "status_check": 選考状況の確認・進捗確認
  - "service_registration": サービス登録案内・プラットフォーム案内
  - "schedule": 面談日程調整・スケジュール確認
  - "other": その他（挨拶、お知らせ、営業メール等）

email_typeが "opportunity" 以外の場合は、{ "email_type": "..." } のみ返してください。

重要: 1通のメールに複数の案件が含まれている場合があります。
- 1案件のみの場合: { "email_type": "opportunity", ...フィールド }
- 複数案件の場合: { "email_type": "opportunity", "opportunities": [ {...}, {...}, ... ] }
各案件は異なる企業・プロジェクトとして独立しています。必ず案件ごとに分けてください。
注意: エージェント情報（agent_name, agent_company, agent_email, agent_phone, platform）はメール送信者の情報です。
複数案件の場合でも、エージェント情報は全案件で共通です。各案件に同じエージェント情報を付与してください。
案件紹介先の企業とエージェント会社を混同しないでください。

各案件の抽出フィールド:
- company_name: 企業名 (株式会社を含む)
- project_title: 案件タイトル (件名や案件概要から簡潔に)
- company_url: 企業HP URL
- location: 所在地
- work_frequency: 稼働頻度 (原文のまま)
- work_style: 働き方 (リモート/常駐/ハイブリッド)
- start_timing: 稼働開始時期
- compensation: 報酬 (原文テキスト)
- compensation_type: "monthly" or "hourly"
- compensation_hourly: 時給の場合、時給額(円、整数)
- compensation_hours_per_week_min: 週の最小稼働時間(整数)
- compensation_hours_per_week_max: 週の最大稼働時間(整数)
- compensation_min: 月額下限 (万円、整数。時給の場合は min時間×4.3×時給÷10000 で算出)
- compensation_max: 月額上限 (万円、整数。時給の場合は max時間×4.3×時給÷10000 で算出)
- summary: 案件概要 (2-3文)
- background: 依頼背景 (簡潔に)
- responsibilities: 業務内容 (主要な項目を箇条書き)
- team_structure: プロジェクト体制
- required_skills: 必須スキル (JSON配列)
- preferred_skills: 歓迎スキル (JSON配列)
- highlights: おすすめポイント
- agent_name: 担当者名
- agent_company: エージェント会社名
- agent_email: 担当者メールアドレス
- agent_phone: 担当者電話番号
- platform: プラットフォーム名
- ai_fit_score: 1-5 (5=最適)
- ai_fit_reason: 1-2文の日本語説明

適合度は以下のプロフィールに基づいて判定してください:
${process.env.FOE_USER_PROFILE || '(プロフィール未設定)'}

JSONのみを返してください。マークダウンのコードブロックは使わないでください。`;
}

/**
 * Call Bedrock Converse API (Qwen3).
 */
async function callBedrock(systemPrompt, userMessage) {
  const client = new BedrockRuntimeClient({ region: BEDROCK_REGION });

  const command = new ConverseCommand({
    modelId: BEDROCK_MODEL,
    system: [{ text: systemPrompt }],
    messages: [
      { role: 'user', content: [{ text: userMessage }] },
    ],
    inferenceConfig: {
      maxTokens: 4096,
      temperature: 0,
    },
  });

  const response = await client.send(command);
  const content = response.output?.message?.content?.[0]?.text?.trim();
  return content || null;
}

/**
 * Call Ollama API (local LLM).
 */
async function callOllama(systemPrompt, userMessage) {
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

  if (!response.ok) {
    console.error(`Ollama API error: ${response.status} ${response.statusText}`);
    return null;
  }

  const data = await response.json();
  return data.message?.content?.trim() || null;
}

/**
 * Normalize extracted opportunity data.
 */
function normalizeOpportunities(parsed) {
  // Non-opportunity email — return as-is
  if (parsed.email_type && parsed.email_type !== 'opportunity') {
    return parsed;
  }

  // Normalize to array of opportunities
  const items = parsed.opportunities ? parsed.opportunities : [parsed];

  for (const item of items) {
    item.email_type = 'opportunity';

    // Normalize weekly hours — LLM sometimes returns monthly hours
    if (item.compensation_hours_per_week_min > 40) {
      item.compensation_hours_per_week_min = Math.round(item.compensation_hours_per_week_min / 4.3);
    }
    if (item.compensation_hours_per_week_max > 40) {
      item.compensation_hours_per_week_max = Math.round(item.compensation_hours_per_week_max / 4.3);
    }

    // Compute monthly compensation from hourly if needed
    if (item.compensation_type === 'hourly' && item.compensation_hourly) {
      const hourly = item.compensation_hourly;
      const minH = item.compensation_hours_per_week_min || 16;
      const maxH = item.compensation_hours_per_week_max || 24;
      item.compensation_min = Math.round(minH * 4.3 * hourly / 10000);
      item.compensation_max = Math.round(maxH * 4.3 * hourly / 10000);
    }

    // Normalize compensation to 万円 if returned in 円
    if (item.compensation_min && item.compensation_min > 1000) {
      item.compensation_min = Math.round(item.compensation_min / 10000);
    }
    if (item.compensation_max && item.compensation_max > 1000) {
      item.compensation_max = Math.round(item.compensation_max / 10000);
    }
  }

  // Return single object for single opportunity, array for multiple
  return items.length === 1 ? items[0] : { email_type: 'opportunity', opportunities: items };
}

/**
 * Extract structured opportunity data from email using LLM.
 * Uses Bedrock Qwen3 by default, falls back to Ollama.
 */
async function extractOpportunity(subject, bodyText) {
  const systemPrompt = buildSystemPrompt();
  const userMessage = `件名: ${subject}\n\n本文:\n${bodyText}`;

  try {
    let content;

    if (USE_BEDROCK) {
      try {
        content = await callBedrock(systemPrompt, userMessage);
      } catch (err) {
        console.error(`Bedrock failed, falling back to Ollama: ${err.message}`);
        content = await callOllama(systemPrompt, userMessage);
      }
    } else {
      content = await callOllama(systemPrompt, userMessage);
    }

    if (!content) return null;

    // Parse JSON, stripping markdown code fences if present
    const jsonStr = content.replace(/^```json?\s*/i, '').replace(/```\s*$/, '').trim();
    // Handle /think blocks from Qwen3
    const cleaned = jsonStr.replace(/<think>[\s\S]*?<\/think>\s*/g, '').trim();
    const parsed = JSON.parse(cleaned);

    return normalizeOpportunities(parsed);
  } catch (err) {
    console.error(`Extraction failed: ${err.message}`);
    return null;
  }
}

/**
 * Generate a reply draft using Ollama LLM (local, low-cost task).
 */
async function generateReplyDraft(opportunity, feedback) {
  const prompt = `以下のフリーランス案件に対して、エージェントへの返信メールのドラフトを作成してください。

案件情報:
- 企業名: ${opportunity.company_name}
- 案件: ${opportunity.project_title}
- 担当者: ${opportunity.agent_name} (${opportunity.agent_company})

私のフィードバック:
${feedback}

以下の点を踏まえた丁寧なビジネスメールを作成してください:
- 担当者名で宛名を書く
- フィードバック内容を自然に組み込む
- 簡潔で礼儀正しいトーン
- 署名は「${process.env.FOE_USER_NAME || '(名前未設定)'}」

メール本文のみを返してください。`;

  try {
    let content;
    if (USE_BEDROCK) {
      content = await callBedrock('あなたはビジネスメール作成アシスタントです。メール本文のみを返してください。', prompt);
    } else {
      const response = await fetch(`${OLLAMA_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: OLLAMA_MODEL,
          messages: [{ role: 'user', content: prompt }],
          stream: false,
          options: { temperature: 0.7 },
        }),
      });
      if (!response.ok) return null;
      const data = await response.json();
      content = data.message?.content?.trim() || null;
    }
    // Strip <think> blocks from Qwen3
    return content?.replace(/<think>[\s\S]*?<\/think>\s*/g, '').trim() || null;
  } catch (err) {
    console.error(`Reply draft generation failed: ${err.message}`);
    return null;
  }
}

module.exports = { extractOpportunity, generateReplyDraft };
