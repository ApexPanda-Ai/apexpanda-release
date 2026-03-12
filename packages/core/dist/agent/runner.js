import { retrieve, buildContext, buildSources } from '../knowledge/rag.js';
import { createRerank } from '../knowledge/rerank.js';
import { getKnowledgeRerankConfig } from '../config/loader.js';
import { getToolsForLLM, invokeToolByName, resolveToolNameForInvocation } from '../skills/registry.js';
import { searchMemoriesForPreInjection } from '../skills/executor.js';
import { addSkill, searchSkillsForPreInjection, parseScriptExecutionResult, findSkillByScriptPath, recordSkillExecution, } from '../skills/skill-store.js';
import { getAgent } from './store.js';
import { getLLMProvider } from './config.js';
import { selectModel } from './model-router.js';
import { getWorkspaceDir, loadConfig, getEffectiveIntentMappings, getMemoryConfig, getOutputBasePath, getMaxOutputTokens } from '../config/loader.js';
const SYSTEM_PROMPT = `你是ApexPanda，用户的智能助手。自我介绍时请说「我是您的智能助手ApexPanda」。核心职责是根据用户指令主动完成操作，而非仅提供建议。
【执行优先】有工具能做的事，直接执行。用户说「打开XX」「创建XX」「查XX」时，优先调用工具完成，勿追问、勿推诿。
【反承诺式执行】涉及外部调用的任务（如搜索、天气、打开网页），必须先完成工具调用、拿到结果后再回复用户。禁止先回复「我将搜索…」「我会为你提供…」等承诺式表述再执行——易因网络失败导致中途停止。应先调用工具，成功则整合结果回复；失败则根据工具返回的【建议】使用 Fallback（如预置清单）直接输出，勿停住。
【全部 Skills 可用】所有已提供的工具均可自由组合使用，请根据用户意图自主推理选择。复杂任务可多步链式调用（如：先搜索→再打开→再操作）。意图映射仅为参考，不必拘泥。
【代码兜底】当某工具失败（如语音识别、API 限频）且消息中提示「请用 file-tools 和 code-runner」时，可用 file-tools 写脚本作为兜底。按环境优先选择 Python（.agent-scripts/voice_asr/voice_asr.py）、无 Python 时可用 Node（.js）或 Shell（.sh）；code-runner 执行 Python，Node/Shell 可用 shell-exec 执行。脚本必须保存到工作区 .agent-scripts/ 目录，语音识别用 .agent-scripts/voice_asr/。
若提供了知识库上下文，请优先依据上下文回答。
【重要】当工具返回空结果、错误或标注「无有效数据」时，必须明确告知用户「未能获取到有效信息」或说明具体失败原因，不可编造、推测或虚构答案。
若引用了知识库内容，请在回答中注明来源编号，如 [1]、[2]。`;
/**
 * 清理消息内容中的大体积 base64 图片数据，防止 token 超限。
 * 用于：① 从 session history 读取历史时；② tool result 写入 messages 时。
 */
function sanitizeMessageContent(content, maxChars = 80_000) {
    if (content.length <= maxChars)
        return content;
    let s = content.replace(/data:image\/[^;,\s]{1,30};base64,[A-Za-z0-9+/]{200,}={0,2}/g, '[图片Base64已省略]');
    s = s.replace(/"imageBase64"\s*:\s*"[A-Za-z0-9+/]{200,}={0,2}"/g, '"imageBase64":"[已省略，防止超出上下文]"');
    if (s.length <= maxChars)
        return s;
    return s.slice(0, maxChars) + `\n[内容已截断，原始长度 ${content.length} 字符]`;
}
/**
 * 根据工具名和参数生成简短摘要，用于渠道回复（冒号后追加进展提示）
 */
function formatToolCallSummaryForChannel(toolName, args) {
    const name = toolName.replace(/#/g, '_').toLowerCase();
    const path = typeof args.path === 'string' ? args.path : typeof args.filePath === 'string' ? args.filePath : '';
    if (name.includes('file-tools_write') || name.includes('file-tools_create')) {
        return path ? `正在创建文件 ${path}` : '正在创建/写入文件';
    }
    if (name.includes('file-tools_read'))
        return path ? `正在读取 ${path}` : '正在读取文件';
    if (name.includes('code-runner_run') || name.includes('code-runner_run_python')) {
        return path ? `正在执行脚本 ${path}` : '正在执行脚本';
    }
    if (name.includes('shell-exec_run')) {
        const cmd = typeof args.command === 'string' ? args.command : '';
        return cmd ? `正在执行命令 ${cmd.slice(0, 120)}${cmd.length > 120 ? '…' : ''}` : '正在执行命令';
    }
    if (name.includes('web-search') || name.includes('web_search')) {
        const q = typeof args.query === 'string' ? args.query : '';
        return q ? `正在搜索「${q.slice(0, 30)}${q.length > 30 ? '…' : ''}」` : '正在搜索';
    }
    if (name.includes('browser-automation') || name.includes('browser_automation'))
        return '正在操作浏览器';
    if (name.includes('ocr-'))
        return '正在识别图片/屏幕文字';
    if (name.includes('image-gen'))
        return '正在生成图片';
    if (name.includes('weather'))
        return '正在获取天气';
    if (name.includes('memory'))
        return '正在读写记忆';
    if (name.includes('node-list') || name.includes('desktop-capturer'))
        return '正在查看设备节点';
    if (name.includes('node-invoke')) {
        if (name.includes('uilaunch'))
            return '正在启动应用';
        if (name.includes('uidump'))
            return '正在分析屏幕界面';
        if (name.includes('uianalyze'))
            return '正在分析屏幕内容';
        if (name.includes('uitap'))
            return '正在点击屏幕';
        if (name.includes('uiswipe'))
            return '正在滑动屏幕';
        if (name.includes('screenocr') || name.includes('screen_ocr'))
            return '正在识别屏幕文字';
        if (name.includes('sysrun') || name.includes('sys_run'))
            return '正在执行节点命令';
        return '正在操作设备节点';
    }
    if (name.includes('delegate_to_worker'))
        return '正在委托子助手';
    const short = toolName.split(/[#_]/).pop() ?? toolName;
    return `正在执行 ${short}`;
}
/** 判断工具结果是否为空/失败，需提醒 LLM 勿编造 */
function isToolResultEmptyOrFailed(raw) {
    try {
        const obj = JSON.parse(raw);
        if (obj === null || obj === undefined)
            return true;
        if (Array.isArray(obj))
            return obj.length === 0;
        if (typeof obj === 'object') {
            const o = obj;
            if (o.error != null && String(o.error).trim() !== '')
                return true;
            if (o.ok === false)
                return true;
            const emptyKeys = ['results', 'rows', 'items', 'data', 'content', 'output', 'relatedTopics'];
            for (const k of emptyKeys) {
                const v = o[k];
                if (Array.isArray(v) && v.length === 0)
                    return true;
                if (v === '' || v === null)
                    return true;
            }
            if (Object.keys(o).length === 0)
                return true;
        }
        if (typeof obj === 'string' && obj.trim().length === 0)
            return true;
    }
    catch {
        const s = raw.trim();
        if (s === '' || s === '{}' || s === '[]')
            return true;
    }
    return false;
}
/** 格式化工具结果，对空/失败结果附加防编造提示 */
function formatToolResultForLLM(raw, isError) {
    const needsWarning = isError || isToolResultEmptyOrFailed(raw);
    if (!needsWarning)
        return raw;
    return `【工具未返回有效数据或执行失败，请明确告知用户，勿编造答案】\n\n${raw}`;
}
/** 增强工具错误信息，附加可操作的 Fallback 建议 */
function enrichToolError(toolName, args, errMsg) {
    const cmd = String(args?.command ?? '');
    if (toolName === 'shell-exec_run' && (cmd.includes('Start-Process') || cmd.includes('WeChat') || cmd.includes('chrome'))) {
        return `${errMsg}\n\n【建议】路径可能不在常见位置。可再次调用 shell-exec_run 执行搜索后启动，如：Get-ChildItem -Path 'C:\\Program Files*','$env:LOCALAPPDATA' -Recurse -Filter 'WeChat.exe' -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName`;
    }
    if (errMsg.includes('Path outside workspace') || errMsg.includes('路径超出工作区')) {
        const path = String(args.path ?? '').trim() || '目标路径';
        const hasContent = args.content != null && String(args.content).trim();
        let suggest = `【建议】请改用 shell-exec_run。`;
        if (hasContent) {
            suggest += ` 写入内容示例（PowerShell）: Set-Content -Path "${path}" -Value (用户要写入的文本) -Encoding UTF8`;
        }
        else {
            suggest += ` 创建空文件: New-Item -Path "${path}" -ItemType File -Force`;
        }
        return `${errMsg}\n\n${suggest}`;
    }
    if (errMsg.includes('City not found') || errMsg.includes('Geocoding failed')) {
        return `${errMsg}\n\n【建议】可尝试 web-search-baidu_search 搜索「XX 天气」获取网页结果。`;
    }
    if (errMsg.includes('Weather API failed') || errMsg.includes('No weather data')) {
        return `${errMsg}\n\n【建议】可尝试 web-search-baidu_search 搜索该城市天气。`;
    }
    if (errMsg.includes('timeout') || errMsg.includes('ETIMEDOUT') || errMsg.includes('Timeout')) {
        return `${errMsg}\n\n【建议】网络或服务响应慢，可请用户稍后重试或换用其他工具。`;
    }
    // web-search 失败时：提示换用其他搜索引擎（web-search-baidu、web-search-google、web-search-bing-cn），通用 Fallback 具体场景
    if (toolName.includes('web-search') || toolName.includes('web_search')) {
        return `${errMsg}\n\n【建议】可尝试 web-search-baidu_search、web-search-google_search 或 web-search-bing-cn_search 替代；或根据用户问题结合常识给出可行建议。勿承诺「将搜索」后停止，应先尝试备选工具再回复。`;
    }
    // browser-automation 失败：Playwright 错误已在 executor 中包装；补充 Fallback
    if ((toolName.includes('browser-automation') || toolName.includes('browser_automation')) && errMsg.includes('npx playwright')) {
        return `${errMsg}\n\n【备选】若无法安装浏览器，可返回目标 URL 让用户手动复制打开。`;
    }
    // docker-manage 失败：常见为 Docker 未安装或未启动
    if ((toolName.includes('docker-manage') || toolName.includes('docker_manage')) && (errMsg.includes('Docker') || errMsg.includes('docker'))) {
        return `${errMsg}\n\n【建议】请确认 Docker 已安装并运行（可执行 docker version 验证）。`;
    }
    // remote-exec 失败：SSH 连接问题
    if ((toolName.includes('remote-exec') || toolName.includes('remote_exec')) && (errMsg.includes('ECONNREFUSED') || errMsg.includes('connect') || errMsg.includes('SSH'))) {
        return `${errMsg}\n\n【建议】请检查 host 可达性、SSH 端口、用户名与认证方式（password 或 privateKey）。`;
    }
    // node-invoke_uiLaunch 失败：包名可能错误
    if ((toolName.includes('node-invoke_uiLaunch') || toolName.includes('uiLaunch')) && (errMsg.includes('package') || errMsg.includes('包') || errMsg.includes('not found') || errMsg.includes('Activity'))) {
        return `${errMsg}\n\n【建议】先用 node-invoke_uiDump 或 node-invoke_uiAnalyze 查看手机屏幕/应用列表，或请用户提供正确包名。勿反复尝试不同包名。`;
    }
    // 脚本执行失败（code-runner 运行 py 文件，或 shell-exec 运行 .py/.js 等脚本）：引导修复重试
    const isScriptRun = toolName.includes('code-runner_runPythonFile') ||
        toolName.includes('runPythonFile') ||
        (toolName.includes('shell-exec_run') && (cmd.includes('.py') || cmd.includes('.js') || cmd.includes('.agent-scripts')));
    if (isScriptRun) {
        return `${errMsg}\n\n【建议】脚本执行失败。请根据 stderr 中的报错（如语法错误、ModuleNotFoundError、ImportError）用 file-tools_write_file 修改脚本后，再次调用 code-runner 或 shell-exec 执行。最多重试 3～5 轮。`;
    }
    return errMsg;
}
export async function runAgent(config, input) {
    const { llm, knowledgeStore, topK = 5, enableTools = true, model: modelOverride, systemPrompt: systemOverride, workerIds = [], mcpServerIds: configMcpServerIds, skillIds: configSkillIds, nodeToolsEnabled: configNodeToolsEnabled, delegationDepth = 0, } = config;
    const { message, history: rawHistory = [], onProgress } = input;
    const history = rawHistory
        .filter((m) => Boolean(m.role && m.content))
        .map((m) => ({
        role: (['system', 'user', 'assistant'].includes(m.role) ? m.role : 'user'),
        content: m.content,
    }));
    let context = '';
    let ragChunks = [];
    if (knowledgeStore) {
        const hasChunks = 'list' in knowledgeStore && typeof knowledgeStore.list === 'function'
            ? (await knowledgeStore.list()).length > 0
            : true; // 无 list 时假定有数据，保持原行为
        if (hasChunks) {
            const rerankCfg = getKnowledgeRerankConfig();
            const rerankFn = rerankCfg ? createRerank(rerankCfg) : null;
            ragChunks = await retrieve({ vectorStore: knowledgeStore, topK, rerank: rerankFn ?? undefined }, message);
            context = buildContext(ragChunks);
        }
    }
    // 记忆预注入：根据当前消息检索相关记忆，自动注入 system prompt
    const memCfg = getMemoryConfig();
    const preInjectTopK = memCfg.preInjectTopK ?? 0;
    let preInjectedMemories = [];
    if (preInjectTopK > 0) {
        preInjectedMemories = await searchMemoriesForPreInjection(message, {
            sessionId: input.sessionId,
            memoryScopeHint: input.memoryScopeHint,
            agentId: input.agentId,
            agentMemoryVisibility: input.agentMemoryVisibility,
            userId: input.userId,
            sessionHistory: rawHistory.slice(-6).map((m) => ({ role: m.role, content: m.content })),
        }, preInjectTopK);
    }
    let basePrompt = systemOverride ?? SYSTEM_PROMPT;
    if (workerIds.length > 0) {
        basePrompt += '\n\n【多 Agent 模式】你是主控 Agent，可将复杂任务分解后使用 delegate_to_worker 工具委托给专家 Worker 执行，再汇总结果回答用户。';
    }
    // Phase 9: 注入 Agent 记忆上下文，帮助 LLM 理解记忆来源与跨 Agent 关联
    if (input.agentId) {
        if (input.agentMemoryVisibility === 'agent-only') {
            basePrompt += '\n\n【记忆说明】你的记忆是本角色专属的，仅对你可见。当检索到的记忆 scope 字段中不含你的 Agent ID 时，表示该记忆来自共享记忆池（用户通用偏好），可作为补充参考。';
        }
        else {
            basePrompt += '\n\n【记忆说明】记忆在所有 Agent 间共享。当你看到记忆条目的 sourceAgentId 字段时，可据此判断该记忆是在哪个 Agent 对话中产生的，有助于理解用户历史意图。';
        }
    }
    // 记忆预注入：将检索到的最相关记忆直接注入，供 LLM 优先参考；如需更多可调用 memory_search
    if (preInjectedMemories.length > 0) {
        const lines = preInjectedMemories.map((m, i) => {
            const label = m.key ? `[${m.key}]` : `[${i + 1}]`;
            return `${label} ${m.content}`;
        });
        basePrompt += `\n\n【用户相关记忆】${lines.join('\n')}`;
    }
    // 过程记忆：检索匹配的历史技能，差异化注入 prompt
    const preInjectedSkills = await searchSkillsForPreInjection(message, 5);
    if (preInjectedSkills.length > 0) {
        const skillHints = preInjectedSkills.map((s) => `· ${s.hint}`).join('\n');
        basePrompt += `\n\n【历史技能可复用】${skillHints}\n优先直接执行上述技能脚本，无需重新创建。`;
    }
    const cfg = await loadConfig();
    const workspaceDir = getWorkspaceDir();
    const fullControl = process.env.APEXPANDA_FULL_CONTROL === 'true' || process.env.APEXPANDA_FULL_CONTROL === '1';
    const outputBase = getOutputBasePath({
        agentId: input.agentId,
        agentMemoryVisibility: input.agentMemoryVisibility,
        userId: input.userId,
        memoryScopeHint: input.memoryScopeHint,
    });
    basePrompt += `\n\n【反追问原则】能推断则推断，勿追问。优先直接执行，勿要求用户补充参数。
【执行环境】当前工作区: ${workspaceDir}。生成的脚本请保存到 .agent-scripts/（工作区内），避免散落被误删。
【脚本复用】涉及执行自动化/脚本任务时，**先**复用再新建：若上文【历史技能可复用】中已有匹配的可信技能，直接按路径执行；否则（1）file-tools_listFiles(path:".agent-scripts") 列子目录；（2）对每个子目录读 file-tools_readFile(path:".agent-scripts/子目录/README.md")，判断功能是否匹配需求；（3）README 匹配时再 readFile 看脚本代码，确认参数/依赖能否满足；（4）README+代码均满足→直接 code-runner/shell-exec 执行；README 匹配但代码不满足→在现有脚本上小幅修改；无匹配→按新建流程。
【脚本创建规范】新建脚本时：（1）先按功能建子目录，**目录名和文件名必须使用英文或拼音缩写，禁止使用中文**（如 .agent-scripts/game-auto/、data-export/、auto-login/），避免路径编码问题；（2）在目录内创建脚本；（3）**创建后必须立即执行**验证；失败则根据 stderr 用 file-tools_write_file 修改后重试，最多 3～5 轮；（4）运行成功后再写 README.md（功能、用法、依赖，README 内容可用中文）；（5）回复用户：脚本路径、简要说明、使用示例。禁止只创建不执行、禁止谎称已完成。
【产出文档】方案、报告、清单等应保存到 ${outputBase}/ 下的 solutions/（方案）、reports/（报告）、checklists/（清单）。示例路径：${outputBase}/solutions/2025-02-26_主题_1.md。
${fullControl
        ? '【完全控制】path 可为任意绝对路径（如 C:\\\\Users\\\\xxx\\\\1.txt），直接 file-tools 创建。打开程序时路径未知可先用 shell 搜索（Get-ChildItem -Recurse -Filter "WeChat.exe" 等）或尝试常见路径。'
        : 'file-tools 的 path 必须相对于工作区；工作区外创建文件用 shell-exec_run（如 Windows: New-Item -Path "D:\\\\1.txt" -ItemType File -Force）。'}
【意图参考】以下为常见说法与工具的对应（可灵活扩展）：XX天气→weather_getCurrent；搜XXX/查XXX→web-search-baidu_search（中文优先，国际/英文可用 web-search-google_search，失败可换 web-search-bing-cn）；搜公众号/公众号文章XXX→wechat-mp-search_search；发公众号/发布文章→按【公众号发布流程】执行；浏览器搜索/打开XX网站→browser-automation；记住XXX→memory_write；上次/和以前一样→memory_search；上次的方案/之前的报告/昨天生成的文档→file-tools_list_output 列出产出目录，再 read_file 读取；执行XX/跑脚本/自动练级/和上次一样操作→按【脚本复用】先 file-tools_listFiles 查 .agent-scripts，读子目录 README 匹配则执行；打开桌面应用→shell-exec_run（含自动搜索路径）；电脑在干嘛/看运行的程序→process-monitor_summary 或 process-monitor_list；有哪些节点/在线节点/查看节点→node-list_list；识别图片/图中文字/OCR→ocr-baidu_recognize（传 path/base64/imageUrl）。路径未找到时可再用 shell-exec 搜索 exe 后启动。
【节点操控】有远程节点在线时，必须调用 node-invoke 执行，禁止仅给建议。（1）Linux/服务器/headless 节点：在 linux 执行/在服务器跑/linux 上 ifconfig→node-invoke_sysRun(command, nodePlatform:"headless")；读节点文件→node-invoke_sysReadFile(path, nodePlatform:"headless")；多 Linux 节点执行→node-invoke_batchSysRun(command, nodePlatform:"headless")。（2）Windows/桌面/desktop 节点：在 windows 执行/在桌面节点跑→node-invoke_sysRun(command, nodePlatform:"desktop")。（3）Android 节点：打开游戏/打开手机应用→node-invoke_uiLaunch(package)；控制手机/操作手机→先 uiDump 或 uiAnalyze 再 uiTap；点击/滑动/录屏/屏幕OCR/自动练级→node-invoke_uiTap/uiSwipe/screenRecord/screenOcr/uiSequence。
【公众号发布流程】用户发公众号时**必须**按以下顺序调用工具：① 解析 title、content；② **formatArticle(title,content)** 得到 formattedContent（含 {{IMG_1}} 等占位符）和 instruction；③ **对每个 {{IMG_N}}**：用 image-gen-dalle 或 image-gen-wanx 根据该段前后文写 prompt 生成，uploadImage(path) 得到 url，将占位符替换为 <img src="url" style="max-width:100%;margin:0.5em 0;border-radius:6px" />；④ **listMaterials** count=10；⑤ **selectCover(title,JSON.stringify(items))** 得到 mediaId 或 needImageGen；⑥ 若 needImageGen 则 image-gen 按 title 生成封面，uploadThumb(path)；⑦ addDraft(title, 已替换插图的 content, thumbMediaId)；⑧ **massSend(mediaId)**。严禁跳过 formatArticle、严禁跳过插图、严禁取 items[0] 当封面（必须 selectCover）。
【删除文件】用户请求删除文件时，工作区内优先用 file-tools_delete_file（path 为相对路径）；工作区外可用 shell-exec_run 执行 rm/del/Remove-Item/rd/rmdir。Agent 执行删除直接完成，无需用户二次确认。
【强制】用户说「打开微信」「打开钉钉」「打开QQ」「打开Chrome」「打开XX网站」等时，必须调用对应工具执行，禁止回复「无法打开」「没有权限」「请手动」等。你已具备该能力，直接完成即可。
【节点操控强制】用户说「在 linux 执行」「在服务器跑」「linux 上 ifconfig」「在 windows 执行」「打开游戏」「控制手机」「点手机」「手机录屏」「自动练级」「操作手机」等时，必须调用 node-invoke 系列工具在已连接的对应节点上执行，禁止仅给建议。先 node-list_list 确认有节点在线；指定平台时必须传 nodePlatform（headless=Linux/服务器，desktop=Windows/桌面，android=手机）。`;
    const effectiveMappings = getEffectiveIntentMappings();
    if (effectiveMappings.length > 0) {
        const mappingLines = effectiveMappings
            .map((m) => `「${m.phrase}」→${m.tool}(${Object.entries(m.params ?? {}).map(([k, v]) => `${k}:"${String(v).replace(/"/g, '\\"')}"`).join(', ')})`)
            .join('；');
        basePrompt += `\n【自定义映射】${mappingLines}。`;
    }
    basePrompt += `\n【Few-shot】例：用户「打开百度」→browser-automation_navigateAndSnapshot(url:"https://www.baidu.com")；用户「搜一下苹果股价」→web-search-baidu_search(query:"苹果股价")；用户「搜公众号 人工智能」→wechat-mp-search_search(query:"人工智能")；用户「xx天气」→weather_getCurrent(city:"兰州")；用户「记住我喜欢咖啡」→memory_write(content:"用户喜欢咖啡")；用户「打开微信」→shell-exec_run；用户「在桌面创建 1.txt」→shell-exec_run 或 file-tools_create_file；用户「删除 test.txt」→file-tools_delete_file(path:"test.txt")；用户「有哪些在线节点」→node-list_list；用户「执行游戏自动练级」或「跑上次的脚本」→先 file-tools_listFiles(path:".agent-scripts")，有子目录则读 README，功能匹配则 code-runner/shell-exec 执行，无匹配则按【脚本创建规范】新建；用户发送图片或说「识别这张图片/图中文字」→ocr-baidu_recognize(path:"消息中给出的路径")或 base64/imageUrl。用户「发公众号」→**必须**按【公众号发布流程】：先 formatArticle，再按 instruction 用 image-gen+uploadImage 替换每个 {{IMG_N}}，listMaterials→selectCover 选封面（勿取第一张），addDraft、massSend。注意：用户发图时消息会包含 path，直接使用；勿用截屏代替 OCR。
【脚本操控例】用户「执行游戏自动练级」→file-tools_listFiles(path:".agent-scripts")→若有 game-auto 等子目录，readFile 读 .agent-scripts/game-auto/README.md→功能匹配则 readFile 看主脚本→code-runner_runPythonFile(path:".agent-scripts/game-auto/main.py")；无则按【脚本创建规范】建 .agent-scripts/game-auto/（英文目录名）、写脚本、执行验证、写 README、回复用户。用户「帮我写个数据导出脚本」→按规范：建 .agent-scripts/data-export/（英文目录名）、write_file 创建 export.py、code-runner 执行、失败则根据 stderr 修改重试、成功则 write_file 写 README.md、回复路径与用法。
【节点操控例】用户「在 linux 节点执行 ifconfig」→node-invoke_sysRun(command:"ifconfig", nodePlatform:"headless")；用户「在服务器上跑 ls /tmp」→node-invoke_sysRun(command:"ls /tmp", nodePlatform:"headless")；用户「在 windows 节点执行 ipconfig」→node-invoke_sysRun(command:"ipconfig", nodePlatform:"desktop")；用户「打开微信/钉钉/Chrome」（有 desktop 节点时）→node-invoke_sysRun(command:"Start-Process WeChat" 或 "Start-Process chrome"，nodePlatform:"desktop")；用户「看看 windows 节点屏幕上有什么字」→node-invoke_screenOcr(nodePlatform:"desktop")；用户「多个 linux 节点都执行 df」→node-invoke_batchSysRun(command:"df -h", nodePlatform:"headless")；用户「打开手机上的微信」→node-invoke_uiLaunch(package:"com.tencent.mm")；用户「打开手机上的XX游戏」→若未知包名，先 node-invoke_uiDump 或 uiAnalyze 查看应用列表/桌面图标，确认包名后再 uiLaunch，**勿**反复尝试多个包名；用户「控制手机点登录」→先 uiAnalyze/uiDump 再 node-invoke_uiTap(text:"登录")；用户「手机自动练级」→node-invoke_uiSequence(actions:[{action:"tap",text:"开始"},...])。`;
    basePrompt += `\n【工具失败 Fallback】当某工具失败时，根据工具返回的【建议】尝试备选工具（如 web-search-baidu 失败→web-search-bing-cn、web-search-360、web-search-google；web-search-google 失败→web-search-baidu）或结合常识给出可行方案。勿承诺「将执行」后停止，应先完成备选调用再回复用户。`;
    basePrompt += `\n【任务完成】当所有步骤均已成功完成时（如脚本运行成功、工具创建完毕、测试全部通过），必须调用 apexpanda_task_done(summary="…") 结束任务，summary 中说明：完成了什么、关键输出（脚本路径、运行结果、文件位置等）。禁止在任务未完成、脚本仍有报错时调用 task_done。任务涉及 .agent-scripts 脚本且成功执行时，可附带 triggerPhrases（用于下次匹配的触发词数组）和 description（技能描述），便于平台沉淀为可复用技能。`;
    const systemContent = context
        ? `${basePrompt}\n\n【知识库参考】\n${context}`
        : basePrompt;
    let tools = enableTools ? await getToolsForLLM({ mcpServerIds: configMcpServerIds, skillIds: configSkillIds, nodeToolsEnabled: configNodeToolsEnabled }) : [];
    const effectiveModel = selectModel(modelOverride, {
        messageLength: message.length,
        historyLength: history.length,
        hasRagContext: context.length > 0,
        hasTools: tools.length > 0,
    });
    const llmResolved = llm ?? getLLMProvider(effectiveModel);
    if (workerIds.length > 0) {
        tools = [
            ...tools,
            {
                type: 'function',
                function: {
                    name: 'apexpanda_delegate_to_worker',
                    description: '将子任务委托给专家 Agent 执行。用于复杂任务分解。',
                    parameters: {
                        type: 'object',
                        properties: {
                            workerId: {
                                type: 'string',
                                description: `Worker Agent ID，可选: ${workerIds.join(', ')}`,
                                enum: workerIds,
                            },
                            task: { type: 'string', description: '子任务描述' },
                        },
                        required: ['workerId', 'task'],
                    },
                },
            },
        ];
    }
    // 方案 A：task_done 工具，LLM 任务完成时主动调用，驱动 Runner 立即返回最终结果
    if (tools.length > 0) {
        tools = [
            ...tools,
            {
                type: 'function',
                function: {
                    name: 'apexpanda_task_done',
                    description: '当所有任务步骤均已成功完成（脚本运行成功、文件创建完毕、测试通过等）时，调用此工具结束任务并向用户输出最终总结。禁止在任务未完成、脚本仍有错误时调用。',
                    parameters: {
                        type: 'object',
                        properties: {
                            summary: {
                                type: 'string',
                                description: '向用户的最终总结：说明完成了什么、关键结果或输出是什么（如脚本路径、运行输出、文件位置等）。',
                            },
                            triggerPhrases: {
                                type: 'array',
                                items: { type: 'string' },
                                description: '可选。脚本类任务成功后，供下次匹配的触发词，如 ["游戏自动登录","自动练级"]',
                            },
                            description: {
                                type: 'string',
                                description: '可选。技能的简短描述，用于过程记忆沉淀。',
                            },
                            expectedKeyword: {
                                type: 'string',
                                description: '可选。stdout 需包含的关键词（内容层校验，防止假成功）。',
                            },
                        },
                        required: ['summary'],
                    },
                },
            },
        ];
    }
    const historyLimit = Number(process.env.APEXPANDA_HISTORY_LIMIT) || 16;
    let messages = [
        { role: 'system', content: systemContent },
        ...history.slice(-historyLimit).map((m) => ({
            ...m,
            content: sanitizeMessageContent(m.content),
        })),
        { role: 'user', content: message },
    ];
    const maxRounds = Number(process.env.APEXPANDA_MAX_TOOL_ROUNDS) || 30;
    const maxToolCallsPerRound = Number(process.env.APEXPANDA_MAX_TOOL_CALLS_PER_ROUND) || 8;
    const loopDetectionEnabled = process.env.APEXPANDA_LOOP_DETECTION_ENABLED !== 'false';
    const loopWarningThreshold = Number(process.env.APEXPANDA_LOOP_WARNING_THRESHOLD) || 4;
    const loopSameToolThreshold = Number(process.env.APEXPANDA_LOOP_SAME_TOOL_THRESHOLD) || 5;
    let lastContent = '';
    let totalUsage = { promptTokens: 0, completionTokens: 0 };
    /** Tool-call 历史，用于 loop-detection */
    const toolCallHistory = [];
    /** 最后一轮 tool calls（用于冒号后追加进展摘要） */
    let lastRoundToolCalls = [];
    /** 渠道进度：每 10 秒累加一次之前执行过的结果，LLM 汇总成 100 字以内的进展上报 */
    const PROGRESS_THROTTLE_MS = 10_000;
    let lastProgressSendTime = 0;
    const accumulatedProgress = [];
    /** 过程记忆：最近一次 .agent-scripts 脚本执行结果，用于 task_done 双重校验 */
    let lastScriptExecution = null;
    for (let round = 0; round < maxRounds; round++) {
        if (process.env.APEXPANDA_DEBUG_CHANNEL === 'true' && round === 0) {
            console.log(`[渠道调试] Agent 开始 LLM 推理 round=1 messageLen=${message.length} historyLen=${history.length} tools=${tools.length}`);
        }
        const maxTokens = getMaxOutputTokens();
        const result = await llmResolved.complete(messages, {
            tools: tools.length > 0 ? tools : undefined,
            model: effectiveModel,
            maxTokens,
        });
        lastContent = result.content;
        if (result.usage) {
            totalUsage.promptTokens += result.usage.promptTokens;
            totalUsage.completionTokens += result.usage.completionTokens;
        }
        if (!result.toolCalls || result.toolCalls.length === 0) {
            if (process.env.APEXPANDA_DEBUG_CHANNEL === 'true') {
                console.log(`[渠道调试] Agent 返回 replyLen=${lastContent?.length ?? 0} completionTokens=${result.usage?.completionTokens ?? '?'}`);
            }
            return {
                reply: lastContent,
                usage: totalUsage.promptTokens > 0 ? totalUsage : undefined,
                model: effectiveModel,
                sources: ragChunks.length > 0 ? buildSources(ragChunks) : undefined,
            };
        }
        const assistantMsg = result;
        const assistantEntry = {
            role: 'assistant',
            content: assistantMsg.content || '',
        };
        if (assistantMsg.toolCalls?.length) {
            assistantEntry.tool_calls = assistantMsg.toolCalls.map((tc) => ({
                id: tc.id,
                type: 'function',
                function: { name: tc.function.name, arguments: tc.function.arguments },
            }));
        }
        messages = [...messages, assistantEntry];
        lastRoundToolCalls = result.toolCalls.map((t) => ({ name: t.function.name, arguments: t.function.arguments || '{}' }));
        // 方案 2：渠道进度——有 toolCalls 即可累积（去掉冒号结尾限制），每 10 秒汇总一次，首条不节流
        if (onProgress && result.toolCalls.length > 0) {
            const summaries = [];
            for (const tc of result.toolCalls) {
                let args = {};
                try {
                    args = JSON.parse(tc.function.arguments || '{}');
                }
                catch {
                    /* ignore */
                }
                summaries.push(formatToolCallSummaryForChannel(tc.function.name, args));
            }
            const unique = [...new Set(summaries)];
            accumulatedProgress.push({ content: (result.content ?? '').trim(), toolSummaries: unique });
            const now = Date.now();
            const shouldSend = lastProgressSendTime === 0 || now - lastProgressSendTime >= PROGRESS_THROTTLE_MS;
            if (shouldSend && accumulatedProgress.length > 0) {
                try {
                    const lines = accumulatedProgress.map((p, i) => `${i + 1}. ${p.content} ${p.toolSummaries.join('、')}`).join('\n');
                    const summaryPrompt = `将以下多条执行进度合并为一条简洁的进展汇报，控制在 100 字以内，让用户知道当前进度即可。只输出合并后的内容，不要其他文字。\n\n${lines}`;
                    const summaryResult = await llmResolved.complete([{ role: 'user', content: summaryPrompt }], { model: effectiveModel, maxTokens: 160, temperature: 0.1 });
                    const summarized = (summaryResult.content ?? lines.split('\n').pop() ?? '').trim().slice(0, 150);
                    if (summarized) {
                        await Promise.resolve(onProgress(summarized));
                        lastProgressSendTime = now;
                    }
                }
                catch (e) {
                    console.warn('[Agent] 进展汇总或发送失败:', e);
                    const fallback = accumulatedProgress
                        .flatMap((p) => p.toolSummaries)
                        .filter((s, i, arr) => arr.indexOf(s) === i)
                        .join('、');
                    if (fallback) {
                        await Promise.resolve(onProgress(`当前进展：${fallback}。`)).catch(() => { });
                        lastProgressSendTime = now;
                    }
                }
                accumulatedProgress.length = 0;
            }
        }
        if (result.toolCalls.length > maxToolCallsPerRound) {
            console.warn(`[Agent] Tool calls limited: ${result.toolCalls.length} -> ${maxToolCallsPerRound} per round`);
        }
        if (process.env.APEXPANDA_DEBUG_CHANNEL === 'true') {
            console.log(`[渠道调试] LLM 本轮请求工具 round=${round + 1} tools=${result.toolCalls.map((t) => t.function.name).join(', ')}`);
        }
        for (let i = 0; i < result.toolCalls.length; i++) {
            const tc = result.toolCalls[i];
            if (i >= maxToolCallsPerRound) {
                messages.push({
                    role: 'tool',
                    content: `【已跳过】本轮工具调用已达上限（${maxToolCallsPerRound}），请根据前述执行结果总结并回复用户，勿再批量调用同一工具。`,
                    tool_call_id: tc.id,
                });
                continue;
            }
            let args;
            try {
                args = JSON.parse(tc.function.arguments || '{}');
            }
            catch (e) {
                console.warn('[Agent] tool args JSON 解析失败（可能被截断）:', tc.function.name, (e instanceof Error ? e.message : String(e)).slice(0, 80));
                const errContent = formatToolResultForLLM('Error: 工具参数 JSON 解析失败（模型输出可能被截断）。请简化命令或分步执行后重试。', true);
                messages.push({ role: 'tool', content: errContent, tool_call_id: tc.id });
                continue;
            }
            if (loopDetectionEnabled) {
                toolCallHistory.push({ tool: tc.function.name, argsKey: tc.function.arguments || '{}' });
                if (toolCallHistory.length > 30)
                    toolCallHistory.shift();
            }
            try {
                let toolResult;
                // 方案 A：task_done 信号——LLM 声明任务完成，立即用 summary 作为最终回复返回
                if (tc.function.name === 'apexpanda_task_done') {
                    const summary = typeof args.summary === 'string' && args.summary.trim()
                        ? args.summary.trim()
                        : lastContent?.trim() || '任务已完成。';
                    let reply = summary;
                    // 过程记忆：双重校验通过则提炼技能（LLM 声明 + exitCode=0 + 可选内容层）
                    const exitOk = lastScriptExecution?.exitCode === 0 && lastScriptExecution?.scriptPath;
                    const expectedKw = typeof args.expectedKeyword === 'string' && args.expectedKeyword.trim();
                    const contentOk = !expectedKw || (lastScriptExecution?.stdout?.includes(expectedKw.trim()) ?? false);
                    const dualVerifyOk = exitOk && contentOk;
                    if (dualVerifyOk && lastScriptExecution) {
                        try {
                            const triggerPhrases = Array.isArray(args.triggerPhrases)
                                ? args.triggerPhrases.filter((x) => typeof x === 'string')
                                : undefined;
                            const desc = typeof args.description === 'string' && args.description.trim()
                                ? args.description.trim()
                                : summary.slice(0, 200);
                            const nameFromPath = lastScriptExecution.scriptPath
                                .replace(/^\.agent-scripts[\\/]/, '')
                                .split(/[\\/]/)[0] || 'script';
                            const successCond = expectedKw ? `exitCode=0，stdout 包含 "${expectedKw}"` : 'exitCode=0';
                            const skill = await addSkill({
                                scriptPath: lastScriptExecution.scriptPath,
                                name: nameFromPath,
                                triggerPhrases: triggerPhrases?.length
                                    ? triggerPhrases
                                    : [message.slice(0, 40).trim() || nameFromPath],
                                description: desc,
                                successCondition: successCond,
                            });
                            if (skill) {
                                if (skill.useCount === 0) {
                                    await recordSkillExecution(lastScriptExecution.scriptPath, true);
                                }
                                reply += `\n\n（已保存为技能「${skill.name}」，下次可直接复用）`;
                            }
                        }
                        catch (e) {
                            console.warn('[Agent] 技能提炼失败:', e instanceof Error ? e.message : String(e));
                        }
                    }
                    return {
                        reply,
                        usage: totalUsage.promptTokens > 0 ? totalUsage : undefined,
                        model: effectiveModel,
                        sources: ragChunks.length > 0 ? buildSources(ragChunks) : undefined,
                    };
                }
                if (tc.function.name === 'apexpanda_delegate_to_worker') {
                    const workerId = String(args.workerId ?? '');
                    const task = String(args.task ?? '');
                    const worker = await getAgent(workerId);
                    if (!worker || !workerIds.includes(workerId)) {
                        toolResult = JSON.stringify({ error: `Worker ${workerId} not found or not allowed` });
                    }
                    else {
                        if (input.onProgress) {
                            const preview = task.length > 50 ? task.slice(0, 50) + '…' : task;
                            await Promise.resolve(input.onProgress(`【${worker.name}】正在执行：${preview}`)).catch(() => { });
                        }
                        const MAX_DELEGATION_DEPTH = 2;
                        const nextDepth = delegationDepth + 1;
                        // 深度 < 最大值时，透传 Worker 自身定义的 workerIds（支持二级委托）；否则截止递归
                        const workerSubIds = nextDepth < MAX_DELEGATION_DEPTH ? (worker.workerIds ?? []) : [];
                        const workerOutput = await runAgent({
                            knowledgeStore,
                            topK,
                            model: worker.model,
                            systemPrompt: worker.systemPrompt,
                            enableTools,
                            workerIds: workerSubIds,
                            mcpServerIds: worker.mcpServerIds,
                            skillIds: worker.skillIds,
                            nodeToolsEnabled: worker.nodeToolsEnabled,
                            delegationDepth: nextDepth,
                        }, { message: task, onProgress: input.onProgress, deleteSource: input.deleteSource ?? 'agent' });
                        toolResult = JSON.stringify({ reply: workerOutput.reply });
                    }
                }
                else {
                    const memCfg = getMemoryConfig();
                    const execCtx = { sessionId: input.sessionId, deleteSource: input.deleteSource ?? 'agent' };
                    if (memCfg.sessionIndexInSearch && input.history?.length) {
                        execCtx.sessionHistory = input.history.map((m) => ({ role: m.role, content: m.content }));
                    }
                    if (input.memoryScopeHint)
                        execCtx.memoryScopeHint = input.memoryScopeHint;
                    if (input.agentId)
                        execCtx.agentId = input.agentId;
                    if (input.agentMemoryVisibility)
                        execCtx.agentMemoryVisibility = input.agentMemoryVisibility;
                    if (input.userId)
                        execCtx.userId = input.userId;
                    const toolName = resolveToolNameForInvocation(tc.function.name);
                    if (process.env.APEXPANDA_DEBUG_CHANNEL === 'true') {
                        const argsPreview = JSON.stringify(args).slice(0, 120);
                        console.log(`[渠道调试] 调用工具 tool=${toolName} args=${argsPreview}${argsPreview.length >= 120 ? '…' : ''}`);
                    }
                    toolResult = await invokeToolByName(toolName, args, execCtx);
                    if (process.env.APEXPANDA_DEBUG_CHANNEL === 'true') {
                        const resPreview = toolResult.slice(0, 80);
                        console.log(`[渠道调试] 工具返回 tool=${toolName} resultLen=${toolResult.length} preview=${resPreview}${toolResult.length > 80 ? '…' : ''}`);
                    }
                }
                // 过程记忆：追踪 .agent-scripts 脚本执行结果（task_done 双重校验）；更新已有技能成功率
                const scriptExec = parseScriptExecutionResult(tc.function.name, args, toolResult);
                let proceduralSkillFailedWithExisting = false;
                if (scriptExec && scriptExec.scriptPath) {
                    lastScriptExecution = { scriptPath: scriptExec.scriptPath, exitCode: scriptExec.exitCode, stdout: scriptExec.stdout };
                    const existing = await findSkillByScriptPath(scriptExec.scriptPath);
                    if (existing) {
                        await recordSkillExecution(scriptExec.scriptPath, scriptExec.exitCode === 0);
                        if (scriptExec.exitCode !== 0)
                            proceduralSkillFailedWithExisting = true;
                    }
                }
                const parsed = (() => {
                    try {
                        return JSON.parse(toolResult);
                    }
                    catch {
                        return null;
                    }
                })();
                // 文件直通：工具返回文件类结果时跳过后续 LLM，直接携带文件信息返回
                // 例外：image-gen-dalle / image-gen-wanx 用于公众号配图时需继续调用 uploadImage，不早退
                const fr = parsed?._fileReply;
                const isImageGenForWechat = (tc.function.name.includes('image-gen-dalle') || tc.function.name.includes('image-gen-wanx')) && parsed?.path;
                if (fr === true && typeof parsed.filePath === 'string' && !isImageGenForWechat) {
                    const fileReply = {
                        fileType: parsed.fileType ?? 'file',
                        filePath: parsed.filePath,
                        mimeType: typeof parsed.mimeType === 'string' ? parsed.mimeType : 'application/octet-stream',
                        caption: typeof parsed.caption === 'string' ? parsed.caption : undefined,
                    };
                    return { reply: fileReply.caption ?? '文件已生成', fileReply, usage: totalUsage.promptTokens > 0 ? totalUsage : undefined, model: effectiveModel };
                }
                if (Array.isArray(fr) && fr.length > 0) {
                    const fileReplies = fr
                        .filter((x) => x != null && typeof x === 'object' && typeof x.filePath === 'string')
                        .map((x) => ({
                        fileType: x.fileType ?? 'file',
                        filePath: x.filePath,
                        mimeType: typeof x.mimeType === 'string' ? x.mimeType : 'application/octet-stream',
                        caption: typeof x.caption === 'string' ? x.caption : undefined,
                    }));
                    if (fileReplies.length > 0) {
                        return { reply: fileReplies[0].caption ?? `${fileReplies.length} 个文件已生成`, fileReplies, usage: totalUsage.promptTokens > 0 ? totalUsage : undefined, model: effectiveModel };
                    }
                }
                if (parsed?._pendingDelete === true && input.sessionId) {
                    const { setPendingDelete } = await import("../delete-confirm/store.js");
                    if (parsed.type === "shell" && typeof parsed.command === "string") {
                        setPendingDelete(input.sessionId, {
                            type: "shell",
                            command: parsed.command,
                            cwd: typeof parsed.cwd === "string" ? parsed.cwd : undefined,
                            env: parsed.env && typeof parsed.env === "object" ? parsed.env : undefined,
                        });
                        const cmdPreview = parsed.command.length > 80 ? parsed.command.slice(0, 80) + "…" : parsed.command;
                        return {
                            reply: `即将执行删除命令：\`${cmdPreview}\`，此操作不可恢复。请回复「确认」或「是」执行，或回复「取消」放弃。`,
                            usage: totalUsage.promptTokens > 0 ? totalUsage : undefined,
                            model: effectiveModel,
                            sources: ragChunks.length > 0 ? buildSources(ragChunks) : undefined,
                        };
                    }
                    if (typeof parsed.path === "string" && typeof parsed.workspaceDir === "string") {
                        setPendingDelete(input.sessionId, { path: parsed.path, workspaceDir: parsed.workspaceDir });
                        return {
                            reply: `即将删除 ${parsed.path}，此操作不可恢复。请回复「确认」或「是」执行删除，或回复「取消」放弃。`,
                            usage: totalUsage.promptTokens > 0 ? totalUsage : undefined,
                            model: effectiveModel,
                            sources: ragChunks.length > 0 ? buildSources(ragChunks) : undefined,
                        };
                    }
                }
                let content = formatToolResultForLLM(toolResult, false);
                // shell-exec 启动程序失败时，附加搜索建议以便 LLM 重试
                if (tc.function.name === 'shell-exec_run') {
                    try {
                        const res = JSON.parse(toolResult);
                        if (res.ok === false && String(args?.command ?? '').match(/Start-Process|WeChat|chrome/i)) {
                            content += '\n\n【建议】路径可能未找到。可再次调用 shell-exec_run，用 Get-ChildItem -Recurse -Filter "程序名.exe" 在 C:\\Program Files*、$env:LOCALAPPDATA 下搜索后 Start-Process。';
                        }
                    }
                    catch {
                        /* ignore */
                    }
                }
                // web-search 系列空结果时，提示换用其他搜索引擎
                if ((tc.function.name.includes('web-search') || tc.function.name.includes('web_search')) && isToolResultEmptyOrFailed(toolResult)) {
                    content += '\n\n【建议】可尝试 web-search-baidu_search、web-search-google_search 或 web-search-bing-cn_search 替代；或根据用户问题结合常识给出可行建议。勿承诺「将搜索」后停止，应先尝试备选工具再回复。';
                }
                if (proceduralSkillFailedWithExisting) {
                    content += '\n\n【建议】该技能执行失败。可用 memory_write 将失败原因（如环境、权限、依赖、报错关键词等）写入记忆，便于下次执行前参考。';
                }
                let finalContent = content;
                if (loopDetectionEnabled && toolCallHistory.length >= loopWarningThreshold) {
                    const recent = toolCallHistory.slice(-Math.min(20, toolCallHistory.length));
                    const same = recent.every((r) => r.tool === recent[0].tool && r.argsKey === recent[0].argsKey);
                    const pingPong = recent.length >= 4 &&
                        recent[0].tool === recent[2].tool &&
                        recent[1].tool === recent[3].tool &&
                        recent[0].tool !== recent[1].tool;
                    const isScriptFixPingPong = pingPong &&
                        ((recent[0].tool.includes('file-tools') &&
                            (recent[1].tool.includes('code-runner') || recent[1].tool.includes('shell-exec'))) ||
                            ((recent[0].tool.includes('code-runner') || recent[0].tool.includes('shell-exec')) &&
                                recent[1].tool.includes('file-tools')));
                    const sameToolCount = recent.filter((r) => r.tool === tc.function.name).length;
                    const sameToolLoop = recent.length >= loopSameToolThreshold && sameToolCount >= loopSameToolThreshold;
                    const shouldWarn = same || (pingPong && !isScriptFixPingPong) || sameToolLoop;
                    if (shouldWarn) {
                        finalContent += '\n\n【检测到重复调用】同一工具被重复调用且无进展，请总结当前结果并直接回复用户，勿再调用工具。';
                    }
                }
                messages.push({
                    role: 'tool',
                    content: sanitizeMessageContent(finalContent),
                    tool_call_id: tc.id,
                });
            }
            catch (e) {
                const errMsg = e instanceof Error ? e.message : String(e);
                if (process.env.APEXPANDA_DEBUG_CHANNEL === 'true') {
                    console.error(`[渠道调试] 工具执行失败 tool=${tc.function.name} error=${errMsg}`);
                }
                let args = {};
                try {
                    args = JSON.parse(tc.function.arguments || '{}');
                }
                catch {
                    /* ignore */
                }
                const enriched = enrichToolError(tc.function.name, args, errMsg);
                const content = formatToolResultForLLM(`Error: ${enriched}`, true);
                messages.push({
                    role: 'tool',
                    content,
                    tool_call_id: tc.id,
                });
            }
        }
    }
    // 方案 1：兜底总结轮——循环因 maxRounds 安全阀耗尽退出时，最后一轮有工具结果但 LLM 未总结
    // 此时再调一次 LLM（禁用 tools），基于当前上下文生成面向用户的最终总结
    if (lastRoundToolCalls.length > 0 && onProgress) {
        await Promise.resolve(onProgress('正在整理最终结果…')).catch(() => { });
    }
    if (lastRoundToolCalls.length > 0) {
        try {
            const summaryResult = await llmResolved.complete([
                ...messages,
                {
                    role: 'user',
                    content: '请根据上述所有工具执行结果，用 2～4 句话向用户总结：完成了什么、关键输出是什么（成功则说明结果，失败则说明原因与当前状态）。直接输出总结内容，无需再调用工具。',
                },
            ], { model: effectiveModel, maxTokens: 400 });
            if (summaryResult.content?.trim()) {
                return {
                    reply: summaryResult.content.trim(),
                    usage: totalUsage.promptTokens > 0 ? totalUsage : undefined,
                    model: effectiveModel,
                    sources: ragChunks.length > 0 ? buildSources(ragChunks) : undefined,
                };
            }
        }
        catch (e) {
            console.warn('[Agent] 兜底总结轮失败，回退至 lastContent:', e instanceof Error ? e.message : String(e));
        }
    }
    // 冒号后追加进展：当 reply 以冒号结尾且最后一轮有 tool call 时，追加工具操作摘要，让用户知道进展
    let finalReply = lastContent ?? '';
    if (/[：:]$/.test(finalReply.trim()) && lastRoundToolCalls.length > 0) {
        const summaries = [];
        for (const tc of lastRoundToolCalls) {
            let args = {};
            try {
                args = JSON.parse(tc.arguments || '{}');
            }
            catch {
                /* ignore */
            }
            summaries.push(formatToolCallSummaryForChannel(tc.name, args));
        }
        const unique = [...new Set(summaries)];
        finalReply = finalReply.trim() + '\n\n' + unique.join('；') + '。';
    }
    return {
        reply: finalReply,
        usage: totalUsage.promptTokens > 0 ? totalUsage : undefined,
        model: effectiveModel,
        sources: ragChunks.length > 0 ? buildSources(ragChunks) : undefined,
    };
}
//# sourceMappingURL=runner.js.map