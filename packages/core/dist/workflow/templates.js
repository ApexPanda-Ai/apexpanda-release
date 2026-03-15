export const WORKFLOW_TEMPLATES = [
    {
        id: 'daily-report',
        name: '日报汇总',
        description: '人工输入今日完成事项，Agent 生成结构化日报',
        nodes: [
            { id: 'input', type: 'human', config: { prompt: '请列出今日完成的工作事项（每行一条）' } },
            {
                id: 'summarize',
                type: 'agent',
                config: {
                    message: '根据用户输入的今日工作事项，生成一份简洁的日报摘要，包含：完成项列表、明日计划建议。输入：\n{{prev}}',
                },
            },
        ],
        edges: [{ from: 'input', to: 'summarize' }],
        suggestedCommand: '/workflow 日报汇总',
        suggestedCron: '0 18 * * 1-5',
    },
    {
        id: 'weekly-report',
        name: '周报汇总',
        description: '人工输入本周工作，Agent 生成周报',
        nodes: [
            { id: 'input', type: 'human', config: { prompt: '请列出本周完成的工作事项、进展、遇到的问题（每类可多条）' } },
            {
                id: 'summarize',
                type: 'agent',
                config: {
                    message: '根据用户输入生成一份周报，包含：本周完成、主要进展、问题与风险、下周计划。结构清晰、条理分明。输入：\n{{prev}}',
                },
            },
        ],
        edges: [{ from: 'input', to: 'summarize' }],
        suggestedCommand: '/workflow 周报汇总',
    },
    {
        id: 'meeting-minutes',
        name: '会议纪要',
        description: '人工输入会议记录，Agent 提炼纪要与待办',
        nodes: [
            { id: 'input', type: 'human', config: { prompt: '请粘贴或输入会议记录/速记内容' } },
            {
                id: 'summarize',
                type: 'agent',
                config: {
                    message: '根据会议记录提炼：1) 核心结论与决策 2) 待办事项（负责人、截止时间）3) 下次会议议题。输入：\n{{prev}}',
                },
            },
        ],
        edges: [{ from: 'input', to: 'summarize' }],
        suggestedCommand: '/workflow 会议纪要',
    },
    {
        id: 'competitor-monitor',
        name: '竞品监控',
        description: '用户输入 URL，Agent 抓取并分析网页',
        nodes: [
            { id: 'urlInput', type: 'human', config: { prompt: '请输入要监控的网页 URL' } },
            {
                id: 'fetchAndAnalyze',
                type: 'agent',
                config: {
                    message: '用户提供了 URL：{{prev}}。请使用 web-fetch 的 fetch_url 工具抓取该页面，分析其中的竞品动态或产品更新，输出结构化摘要。',
                },
            },
        ],
        edges: [{ from: 'urlInput', to: 'fetchAndAnalyze' }],
        suggestedCommand: '/workflow 竞品监控',
    },
    {
        id: 'public-opinion-monitor',
        name: '舆情监测',
        description: '按关键词监测舆情，无 URL 时自动从百度、公众号(搜狗微信)等检索并分析',
        nodes: [
            {
                id: 'collectAndDetect',
                type: 'agent',
                config: {
                    message: `你是舆情监测执行助手。**禁止输出任何询问语，必须立即按步骤调用工具执行，不得等待用户确认。**

工作流名称：{{workflowName}}
用户输入：{{prev}}

【第一步：确定关键词】
取工作流名称中「舆情监测」前的所有内容拆分为关键词列表，例如：「XXXXXX有限责任公司舆情监测」→ ["XXXXXX有限责任公司","XXXXXX"]；「A·B舆情监测」或「A与B舆情监测」→ ["A","B"]。若用户输入也包含公司/品牌名，追加进列表。

【第二步：获取内容（二选一）】
- 若用户输入含 URL：直接用 web-fetch-clean 抓取该 URL 正文，跳过搜索
- 否则：对每个关键词分别调用 web-search-baidu 和 wechat-mp-search 搜索，收集返回的 URL，再用 web-fetch-clean 逐条抓取正文（取前 3-5 条，跳过无法访问的）

【第三步：调用检测】
合并所有正文，调用 public-opinion-monitoring_detect，传入：
- text：合并后的全部正文
- keywords：第一步得到的关键词数组
- source：「百度+微信搜索」或「URL抓取」

【第四步：输出】
1) 输出 detect 返回的 report 字段内容
2) 在 report 末尾附加「## 监测到的文章」章节，列出本次抓取/检索到的所有文章，格式为「- [标题](URL)」每行一条。标题和 URL 来自 web-search-baidu、wechat-mp-search 的 results 以及 web-fetch-clean 的 url 字段；若某条无法获取标题则用「(无标题)」或 URL 代替。无文章时写「无」。`,
                },
            },
            {
                id: 'summarize',
                type: 'agent',
                config: {
                    message: `根据以下舆情监测报告生成 AI 总结，适合发送到群聊。必须包含：
1) 关键发现与敏感预警
2) 监测到的文章列表：若报告中有「## 监测到的文章」章节，必须将文章标题与链接原样纳入总结；若无该章节或为空，可省略

若输入为空、报告无内容或正文均为空，请直接输出「本次监测未获取到有效内容，建议检查网络或稍后重试。」，不要询问用户提供任何内容。

输入：
{{prev}}`,
                },
            },
        ],
        edges: [{ from: 'collectAndDetect', to: 'summarize' }],
        suggestedCommand: '/workflow 舆情监测',
        suggestedCron: '0 9 * * *',
    },
    {
        id: 'customer-service-routing',
        name: '客服分流',
        description: '用户输入问题，Agent 识别意图并给出分类建议',
        nodes: [
            { id: 'userInput', type: 'human', config: { prompt: '请输入用户反馈或咨询内容' } },
            {
                id: 'classify',
                type: 'agent',
                config: {
                    message: '根据用户输入识别意图类型（咨询/投诉/反馈/其他），并给出建议处理方式。输入：\n{{prev}}',
                },
            },
        ],
        edges: [{ from: 'userInput', to: 'classify' }],
        suggestedCommand: '/workflow 客服分流',
    },
    {
        id: 'news-brief',
        name: '新闻简报',
        description: '自动抓取科技新闻，Agent 生成每日简报',
        nodes: [
            { id: 'fetchNews', type: 'skill', config: { skillName: 'news-aggregator', toolId: 'fetch', params: { limit: 8 } } },
            {
                id: 'report',
                type: 'agent',
                config: {
                    message: '根据以下新闻列表，生成一份科技日报简报：提炼 3-5 条重要动态，每条一句话，按重要性排序。新闻：\n{{prev}}',
                },
            },
        ],
        edges: [{ from: 'fetchNews', to: 'report' }],
        suggestedCron: '0 9 * * *',
    },
    {
        id: 'translate',
        name: '文本翻译',
        description: '人工输入待翻译文本，Skill 自动翻译为目标语言',
        nodes: [
            { id: 'input', type: 'human', config: { prompt: '请输入要翻译的文本（支持 auto 自动检测源语言）' } },
            {
                id: 'translate',
                type: 'skill',
                config: { skillName: 'translate', toolId: 'translate', params: { text: '{{prev}}', from: 'auto', to: 'zh' } },
            },
        ],
        edges: [{ from: 'input', to: 'translate' }],
        suggestedCommand: '/workflow 文本翻译',
    },
    {
        id: 'wechat-mp-publish',
        name: '公众号发布',
        description: '人工输入标题与正文，自动发布到微信公众号。支持智能选封面（按标题匹配或 AI 生成）、自动配图、排版优化（需配置 WECHAT_MP_APP_ID、WECHAT_MP_APP_SECRET，可选 image-gen 生成配图）',
        nodes: [
            {
                id: 'input',
                type: 'human',
                config: {
                    prompt: `请输入要发布的公众号文章。

格式：
标题：xxx
正文：xxx（支持 HTML。可留空，Agent 会自动配图与排版）
封面：（可选）见下方说明

若仅一行则视为标题，正文留空时用标题作为正文。

【正文插图】可选。若有占位符则替换；若无占位符，Agent 会按段落自动插入 2-4 张配图（AI 生成或素材库）：
• {{img:path:路径}} → 上传后插入
• {{img:url:https://xxx.jpg}} → 上传后插入
• {{img:第N张}} → 素材库第 N 张
• {{img:图片名}} → 素材库按 name 匹配

【封面】可选，留空或「自动」时智能选择或 AI 生成，禁止固定选第一张：
• path:工作区内路径 或 url:图片URL → 上传后作封面
• 第2张、第3张 → 素材库第 N 张
• 图片名 → 素材库按 name 匹配
• 自动/留空 → 素材库按标题关键词匹配 name 选最相关的一张；若无匹配则用 image-gen 根据标题生成封面`,
                },
            },
            {
                id: 'publish',
                type: 'agent',
                config: {
                    message: `你是公众号发布助手。**必须按步骤依次调用工具，严禁跳过。**

用户输入：{{prev}}

【步骤 1】解析 title、content（content 为空时用 title）。

【步骤 2：排版+插图占位】调用 **formatArticle**（title, content）→ 得到 formattedContent（含 {{IMG_1}}、{{IMG_2}} 等）和 instruction。

【步骤 3：替换插图】对 formattedContent 中每个 {{IMG_N}}：用 image-gen-dalle 或 image-gen-wanx 根据该处前后段落主题写 prompt 生成图片，uploadImage(path) 得到 url，替换为 <img src="url" style="max-width:100%;margin:0.5em 0;border-radius:6px" />。**严禁跳过，否则文章无图。**

【步骤 4：封面】listMaterials offset=0 count=10 → 得到 items。调用 **selectCover**（title, JSON.stringify(items)）→ 若返回 mediaId 则作 thumbMediaId；若 needImageGen 则 image-gen 按 title 生成封面，uploadThumb(path)。**严禁取 items[0]，必须用 selectCover。**

【步骤 5】addDraft(title, 已替换插图的 content, thumbMediaId)。

【步骤 6】massSend(mediaId)。`,
                },
            },
        ],
        edges: [{ from: 'input', to: 'publish' }],
        suggestedCommand: '/workflow 公众号发布',
    },
    {
        id: 'data-brief',
        name: '数据汇总',
        description: '获取时间等数据后 Agent 生成简报',
        nodes: [
            { id: 'getData', type: 'skill', config: { skillName: 'calculator', toolId: 'get_time' } },
            {
                id: 'report',
                type: 'agent',
                config: { message: '当前时间为 {{prev}}。请生成一份今日简报开头模板（日期、时间、简短问候）' },
            },
        ],
        edges: [{ from: 'getData', to: 'report' }],
        suggestedCron: '0 9 * * *',
    },
];
/** 同步：仅系统预设模板（兼容旧调用） */
export function listWorkflowTemplates() {
    return WORKFLOW_TEMPLATES;
}
/** 异步：系统 + 用户自定义模板合并 */
export async function listWorkflowTemplatesMerged() {
    const { listCustomTemplates, mergeTemplates } = await import('./custom-templates.js');
    const customs = await listCustomTemplates();
    return mergeTemplates(WORKFLOW_TEMPLATES, customs);
}
export function getWorkflowTemplate(id) {
    return WORKFLOW_TEMPLATES.find((t) => t.id === id);
}
/** 异步：从系统 + 自定义模板中查找 */
export async function getWorkflowTemplateMerged(id) {
    const sys = getWorkflowTemplate(id);
    if (sys)
        return sys;
    const customs = await (await import('./custom-templates.js')).listCustomTemplates();
    return customs.find((t) => t.id === id);
}
//# sourceMappingURL=templates.js.map