// scripts/gen-guides.js — 攻略批量生成（公开素材 + OpenRouter API）
// 用法：
//   1. 在 materials/<IATA>.txt 放入人工采集的公开攻略素材（Wikivoyage/官方旅游局等，注明来源）
//   2. export OPENROUTER_API_KEY=sk-or-...  （或把 key 写入项目根目录 openrouter.txt）
//   3. node scripts/gen-guides.js SIN BKK          # 生成指定枢纽
//      node scripts/gen-guides.js SIN --dry-run    # 只打印 prompt 不调用
// 输出：generated/<IATA>.json（与 src/mocks/hubs.ts 的 HubL.layoverOptions 结构一致，可直接合入或写云数据库）
// 注意：签证/交通字段不由模型生成（人工维护，避免幻觉）；生成文本上线前需过微信 msgSecCheck
const fs = require('fs')
const path = require('path')

// Key 来源：环境变量优先，其次项目根目录 openrouter.txt（该文件已加入 .gitignore）
function loadApiKey() {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY
  const p = path.join(__dirname, '..', 'openrouter.txt')
  if (fs.existsSync(p)) {
    const k = fs.readFileSync(p, 'utf-8').trim()
    if (k) return k
  }
  return null
}

const API_KEY = loadApiKey()
const MODEL = process.env.GUIDE_MODEL || 'deepseek/deepseek-chat'
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'

const ICONS = ['🍜', '🏛', '🌿', '🛍', '🌙', '🌃', '🏝']
const DURATIONS = ['8h', '12h', '24h']
const SOURCES = ['xiaohongshu', 'reddit', 'backpackers', 'official']

function buildPrompt(iata, material) {
  return `你是航空中转停留攻略编辑。基于下面的公开素材，为机场 ${iata} 所在城市生成中转停留玩法数据。

严格输出 JSON（不要 markdown 代码块），结构如下：
{
  "layoverOptions": [
    {
      "duration": "8h" | "12h" | "24h",
      "budget": { "currency": "当地货币三字码", "min": 数字, "max": 数字 },
      "activities": [
        {
          "icon": "${ICONS.join('" | "')}",
          "title": { "zh": "中文标题(≤8字)", "en": "English title" },
          "description": { "zh": "中文一句话(≤30字，含实用细节)", "en": "English one-liner" },
          "source": "${SOURCES.join('" | "')}"
        }
      ]
    }
  ]
}

要求：
1. 只能使用素材中出现的地点与事实，不得编造；素材不足的时长档位可省略
2. 每个时长档位 2-3 个活动，按"离机场近/耗时短"优先排进短时长档
3. 不要生成签证、机场交通信息
4. source 按素材来源标注，官方内容用 official

素材：
${material}`
}

async function generate(iata, dryRun) {
  const materialPath = path.join(__dirname, '..', 'materials', `${iata}.txt`)
  if (!fs.existsSync(materialPath)) {
    console.error(`跳过 ${iata}：缺少素材文件 materials/${iata}.txt`)
    return
  }
  const material = fs.readFileSync(materialPath, 'utf-8').trim()
  const prompt = buildPrompt(iata, material)

  if (dryRun) {
    console.log(`----- ${iata} prompt -----\n${prompt}\n`)
    return
  }
  if (!API_KEY) throw new Error('缺少 OpenRouter API Key（设置环境变量 OPENROUTER_API_KEY，或写入项目根目录 openrouter.txt）')

  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.3,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt }]
    })
  })
  if (!res.ok) throw new Error(`openrouter ${res.status}: ${await res.text()}`)
  const json = await res.json()
  const content = json.choices?.[0]?.message?.content ?? ''

  // 解析 + 结构校验（icon/duration/source 白名单，双语字段齐全）
  const data = JSON.parse(content)
  const options = (data.layoverOptions ?? []).filter(opt => {
    if (!DURATIONS.includes(opt.duration)) return false
    opt.activities = (opt.activities ?? []).filter(
      act =>
        ICONS.includes(act.icon) &&
        SOURCES.includes(act.source) &&
        act.title?.zh && act.title?.en &&
        act.description?.zh && act.description?.en
    )
    return opt.activities.length > 0 && opt.budget?.currency
  })
  if (options.length === 0) throw new Error(`${iata}: 生成结果未通过校验`)

  const outDir = path.join(__dirname, '..', 'generated')
  fs.mkdirSync(outDir, { recursive: true })
  const outPath = path.join(outDir, `${iata}.json`)
  fs.writeFileSync(outPath, JSON.stringify({ iata, model: MODEL, generatedAt: new Date().toISOString(), layoverOptions: options }, null, 2))
  console.log(`✔ ${iata} → generated/${iata}.json（${options.length} 个时长档位，用量 ${json.usage?.total_tokens ?? '?'} tokens）`)
}

async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const iatas = args.filter(a => /^[A-Z]{3}$/i.test(a)).map(a => a.toUpperCase())
  if (iatas.length === 0) {
    console.log('用法：node scripts/gen-guides.js <IATA...> [--dry-run]')
    return
  }
  for (const iata of iatas) {
    try {
      await generate(iata, dryRun)
    } catch (e) {
      console.error(`✘ ${iata}: ${e.message}`)
    }
  }
}

main()
