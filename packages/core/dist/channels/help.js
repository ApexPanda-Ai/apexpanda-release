/**
 * 渠道帮助命令：/help、/帮助
 * 返回统一的操作说明，按渠道配置动态裁剪内容
 * 二期：支持 /help 子主题 查看某一类详细说明
 */
import { listAgents } from '../agent/store.js';
import { listWorkflows } from '../workflow/store.js';
import { isChannelAgentCreateEnabled, getChannelMentionEnabled, getDiscussionConfig, getMultiAgentConfig } from '../config/loader.js';
import { AGENT_TEMPLATES } from '../agent/agent-create-intent.js';
import { listWorkflowTemplatesMerged } from '../workflow/templates.js';
function parseTopic(param) {
    if (!param || !param.trim())
        return '';
    const t = param.toLowerCase().replace(/\s+/g, ' ').trim();
    if ((t.includes('agent') || t.includes('智能体')) && (t.includes('create') || t.includes('创建')))
        return 'create-agent';
    if (t.includes('workflow') || t.includes('工作流'))
        return t.includes('create') || t.includes('创建') ? 'create-workflow' : 'workflow';
    if (t.includes('discussion') || t.includes('讨论') || t.includes('debate'))
        return 'discussion';
    if (t.includes('nodes') || t.includes('节点'))
        return 'nodes';
    if (t.includes('multi') || t.includes('协同') || t.includes('多agent') || t.includes('流水线') || t.includes('并行') || t.includes('plan'))
        return 'multi-agent';
    if (t.includes('agent') || t.includes('对话') || t.includes('智能体'))
        return 'agent';
    return '';
}
function formatAgentSection(hasAgents, mentionEnabled) {
    const atHint = mentionEnabled ? '' : '（当前未开启）';
    if (!hasAgents) {
        return `一、与智能体对话 | Chat with Agent
  暂无智能体，请先在 Dashboard 中创建。`;
    }
    return `一、与智能体对话 | Chat with Agent
  • /agent 名称 问题  指定智能体提问
    例：/agent 产品经理 写个PRD
  • @名称 问题${atHint}  提及指定智能体
    例：@产品经理 需求分析
  • #名称 问题  井号指定智能体
    例：#客服 退款流程
  • 直接发送  使用默认智能体
  💡 /agent 单独发送可查看可用智能体列表`;
}
function formatAgentSectionEmpty(agentCreateEnabled) {
    const createHint = agentCreateEnabled ? '，或使用 /创建agent /create-agent' : '';
    return `一、与智能体对话 | Chat with Agent
  暂无智能体，请先在 Dashboard 中创建${createHint}。`;
}
function formatCreateWorkflowSection() {
    return `二、创建工作流 | Create Workflow
  • /创建工作流 描述 /create-workflow 描述
    例：/创建工作流 每日发送销售报表 或 /create-workflow 每日发送销售报表`;
}
function formatCreateAgentSection() {
    return `三、创建智能体 | Create Agent
  • /创建agent 描述 /create-agent 描述
    例：/创建agent 数据分析助手 或 /create-agent 数据分析助手
  • 自然语言  例：建个客服机器人、创建个数据分析 agent`;
}
function formatRunWorkflowSection(hasWorkflows) {
    if (!hasWorkflows) {
        return `四、运行工作流 | Run Workflow
  暂无工作流，可先使用 /创建工作流 /create-workflow 创建。`;
    }
    return `四、运行工作流 | Run Workflow
  • /工作流 名称 内容 /workflow 名称 内容
    例：/workflow 日报汇总 今日完成需求评审
  • 工作流名支持模糊匹配；内容可为空，用于人工节点提示`;
}
function formatDiscussionSection() {
    return `五、多 Agent 讨论 | Multi-Agent Discussion
  • /讨论 问题 [轮数] [@Agent...] /debate 问题 [轮数] [@Agent...]
    例：/讨论 定价策略 5 @产品 @技术 或 /debate pricing 5 @产品 @技术
  • 结束讨论：输入「结束讨论」「停止」「可以了」或 "stop"`;
}
function formatMultiAgentSection() {
    const cfg = getMultiAgentConfig();
    const modeHint = cfg.collabMode !== 'supervisor' ? `（当前全局模式：${cfg.collabMode}）` : '';
    return `七、多 Agent 协同 | Multi-Agent Collaboration${modeHint}
  • @ 多个 Agent 自动协同：@产品 @设计 @开发 做个登录页
  • 消息前缀可指定模式（优先级高于全局配置）：
    /流水线  /pipeline  — 按 @ 顺序执行，前一产出传给下一个
    /并行    /parallel  — 所有 Agent 同时执行，结果汇总
    /规划    /plan      — LLM 动态生成 DAG 再执行（支持循环）
  • 示例：
    /流水线 @产品 @设计 @开发 做个登录页
    /并行 @数据分析 @图表 出销售报表
    /规划 @Taskmaster @android_ui @dev @gamedev 游戏自动化
  • @ 间支持逗号、顿号等分隔：@产品，@设计，@开发 做个登录页
  💡 /help 协同 查看详细说明`;
}
/** 多 Agent 协同详细帮助 */
function formatMultiAgentHelpDetail() {
    const cfg = getMultiAgentConfig();
    return `【多 Agent 协同 - 详细说明 | Multi-Agent Collaboration - Detail】

触发：消息中 @ 2 个及以上 Agent，系统自动进入协同模式。

一、协同模式
  • 主从式（supervisor，默认）：选一个主控，其余为 Worker，主控通过 delegate_to_worker 委托子任务
  • 流水线（pipeline）：按 @ 顺序依次执行，前一 Agent 产出作为后一 Agent 输入
  • 并行（parallel）：所有 Agent 同时执行同一任务，结果按 Agent 分段汇总
  • 动态规划（plan）：LLM 根据任务与 Agent 能力生成 DAG，支持串行、并行、循环混合

二、消息内联模式（优先于全局配置）
  /流水线 /pipeline  /并行 /parallel  /规划 /plan
  例：/流水线 @产品 @设计 @开发 做个登录页

三、当前全局配置
  • 模式：${cfg.collabMode}（可在 config.json → multiAgent.collabMode 修改）
  • 主控策略：${cfg.leaderSelection}（workerIds=含 Worker 者优先 / first=第一个 / capability=能力打分）
  • plan 需确认：${cfg.planConfirmRequired ? '是（生成计划后等你回复「确认」）' : '否（直接执行）'}

四、Agent 权限控制（在 Dashboard 中配置）
  • skillIds：限制可用 Skill 工具（[] = 无 Skill，纯委托角色用）
  • nodeToolsEnabled：false = 不注入 node-invoke 工具（防止主控越权操作设备）

五、@ 格式支持
  • @名称 — 最常用
  • @handle — 短别名
  • 多个 @ 间可用逗号、顿号分隔：@产品，@设计，@开发 任务

输入 /help /帮助 可查看完整说明。`;
}
function formatNodesSection() {
    return `六、查看在线节点 | Online Nodes
  • /节点 /nodes  查看当前连接的设备节点列表
  • /自动执行 /auto-exec 或 自动执行模式  该会话后续节点命令免审批
  • /取消自动执行 /cancel-auto 或 取消自动执行模式  关闭自动执行`;
}
/** 节点帮助详情 */
function formatNodesHelpDetail() {
    return `【查看在线节点 - 详细说明 | Online Nodes - Detail】

命令：/节点 /nodes

功能：列出当前已连接 Gateway 的设备节点（Headless、桌面端、移动端等），包括节点名称、平台、能力、连接时间。也可直接向智能体提问「有哪些在线节点」「查看节点」。

【自动执行模式 | Auto-Execute Mode】

开启：/自动执行 /auto-exec 或 自动执行模式
关闭：/取消自动执行 /cancel-auto 或 取消自动执行模式

开启后，该会话后续的节点命令将自动批准，无需在 Dashboard 手动审批。

输入 /help /帮助 可查看完整说明。`;
}
/** 二期：创建智能体详细帮助 */
function formatCreateAgentHelpDetail() {
    const confirmHint = process.env.APEXPANDA_AGENT_CREATE_CONFIRM === 'true'
        ? '\n• 确认模式已开启：会先展示预览，回复「确认」后创建'
        : '';
    const templates = AGENT_TEMPLATES.map((t) => `  - ${t.id}: ${t.name}（${t.description}）`).join('\n');
    return `【创建智能体 - 详细说明 | Create Agent - Detail】

命令：/创建agent 描述 /create-agent 描述
  例：/创建agent 数据分析助手 或 /create-agent 数据分析助手

自然语言：建个客服机器人、创建个数据分析 agent、帮我做个研究助手

可用模板：
${templates}
${confirmHint}

创建成功后可用 @名称、#名称、/agent 名称 调用。

输入 /help /帮助 可查看完整说明。`;
}
/** 二期：创建工作流详细帮助 */
async function formatCreateWorkflowHelpDetail() {
    const confirmHint = process.env.APEXPANDA_WORKFLOW_CREATE_CONFIRM === 'true'
        ? '\n• 确认模式已开启：会先展示预览，回复「确认」后创建'
        : '';
    let templates;
    try {
        const tpls = await listWorkflowTemplatesMerged();
        templates = tpls.map((t) => `  - ${t.id}: ${t.name}（${t.description}）${t.suggestedCron ? '，可定时' : ''}${t.suggestedCommand ? `，示例：${t.suggestedCommand}` : ''}`).join('\n');
    }
    catch {
        templates = '  （加载失败）';
    }
    return `【创建工作流 - 详细说明 | Create Workflow - Detail】

一、从模板创建
  • Dashboard 一键创建：工作流页点击「✓ 模板名」直接创建
  • Dashboard 编辑后创建：选模板 → 在编辑器中调整 nodes/edges/triggers → 保存
  • 渠道创建：/创建工作流 描述，AI 从模板匹配并创建

二、保存为模板
  在工作流编辑页点击「另存为模板」，填写名称、描述、建议命令（如 /workflow 日报汇总）。
  自定义模板会出现在模板列表和渠道创建中，供后续复用。

三、可用模板（系统预设 + 用户自定义）
${templates}

四、渠道调用示例
  • 消息触发：/workflow {名称} {输入}  例：/workflow 日报汇总 今日完成需求评审
  • 定时触发：创建工作流时可选 cron，结果推送至创建时所在群/会话
  • Webhook：POST /webhooks/workflow/{workflowId}

定时 cron：每天9点=0 9 * * *，工作日18点=0 18 * * 1-5
${confirmHint}

输入 /help /帮助 可查看完整说明。`;
}
/** 二期：讨论详细帮助 */
function formatDiscussionHelpDetail() {
    const cfg = getDiscussionConfig();
    const endSample = cfg.endPhrases.slice(0, 5).join('、');
    return `【多 Agent 讨论 - 详细说明 | Discussion - Detail】

触发：/讨论 /debate
格式：/讨论 问题 [轮数] [@Agent1 @Agent2...] 或 /debate 问题 [轮数] [@Agent1 @Agent2...]
  • 问题、轮数、@Agent 顺序任意，轮数默认 ${cfg.defaultRounds}（最大 ${cfg.maxRounds}），@Agent 省略则全员参与（最多 ${cfg.maxAgents} 个）

示例：/讨论 这个需求是否值得做MVP | /debate 技术选型 2 @架构师

结束：输入「${endSample}」${cfg.endPhrases.length > 5 ? '等' : ''}或 "stop"

输入 /help /帮助 可查看完整说明。`;
}
/** 二期：工作流详细帮助 - 触发方式、人工节点、定时、渠道回复 */
function formatWorkflowHelpDetail() {
    return `【工作流 - 详细说明 | Workflow - Detail】

触发方式：
  • 消息触发：/workflow 名称 输入 或 /工作流 名称 输入
    例：/workflow 日报汇总 今日完成需求评审
    工作流名支持模糊匹配；内容可为空，用于人工节点提示
  • 定时触发：在创建工作流时选择 cron（如每天 9 点），结果推送至创建时所在群/会话
  • Webhook：POST /webhooks/workflow/{workflowId}

人工节点：若工作流含人工输入节点，运行时会暂停等待输入，在 Dashboard 或渠道中提交后继续。

渠道回复：工作流完成后，结果会发送回触发时的群/会话。

输入 /help 创建工作流 查看如何创建；输入 /help /帮助 可查看完整说明。`;
}
/** 二期：与智能体对话详细帮助 */
function formatAgentHelpDetail(mentionEnabled) {
    const atHint = mentionEnabled ? '' : '（当前未开启 @ 提及）';
    return `【与智能体对话 - 详细说明 | Chat with Agent - Detail】

指定方式：
  • /agent 名称 问题  例：/agent 产品经理 写个PRD
  • @名称 问题${atHint}  例：@产品经理 需求分析
  • #名称 问题  例：#客服 退款流程
  • 直接发送  使用渠道默认智能体

/agent 单独发送可查看可用智能体列表。

输入 /help /帮助 可查看完整说明。`;
}
/**
 * 根据渠道与配置生成帮助文案
 */
export async function formatChannelHelp(channel, topicParam) {
    const topic = parseTopic(topicParam);
    const agentCreateEnabled = isChannelAgentCreateEnabled(channel);
    const mentionEnabled = getChannelMentionEnabled(channel);
    // 二期：子主题详细帮助
    if (topic === 'create-agent' && agentCreateEnabled) {
        return formatCreateAgentHelpDetail();
    }
    if (topic === 'create-workflow') {
        return await formatCreateWorkflowHelpDetail();
    }
    if (topic === 'workflow') {
        return formatWorkflowHelpDetail();
    }
    if (topic === 'discussion') {
        return formatDiscussionHelpDetail();
    }
    if (topic === 'agent') {
        return formatAgentHelpDetail(mentionEnabled);
    }
    if (topic === 'nodes') {
        return formatNodesHelpDetail();
    }
    if (topic === 'multi-agent') {
        return formatMultiAgentHelpDetail();
    }
    let agents = [];
    let workflows = [];
    try {
        [agents, workflows] = await Promise.all([listAgents(), listWorkflows()]);
    }
    catch (e) {
        console.error('[help] listAgents/listWorkflows error:', e);
        return '【渠道操作说明】\n\n帮助信息加载失败，请稍后重试。\n\n输入 /help /帮助 可再次查看。';
    }
    const hasAgents = agents.length > 0;
    const hasWorkflows = workflows.length > 0;
    const sections = [];
    // 一、与智能体对话
    if (hasAgents) {
        sections.push(formatAgentSection(true, mentionEnabled));
    }
    else {
        sections.push(formatAgentSectionEmpty(agentCreateEnabled));
    }
    // 二、创建工作流
    sections.push(formatCreateWorkflowSection());
    // 三、创建智能体（按配置）
    if (agentCreateEnabled) {
        sections.push(formatCreateAgentSection());
    }
    // 四、运行工作流
    sections.push(formatRunWorkflowSection(hasWorkflows));
    // 五、多 Agent 讨论
    sections.push(formatDiscussionSection());
    // 六、查看在线节点
    sections.push(formatNodesSection());
    // 七、多 Agent 协同
    sections.push(formatMultiAgentSection());
    return `【渠道操作说明】\n\n${sections.join('\n\n')}\n\n输入 /help /帮助 可再次查看本说明`;
}
//# sourceMappingURL=help.js.map