import { listWorkflows } from './store.js';
/** 命令格式：/workflow 名称 内容 或 /工作流 名称 内容（支持 ，,：: 作为分隔符）；(?![^\s,，：:]) 防止 /工作流x 误匹配 */
const WORKFLOW_CMD_REG = /^\/(?:workflow|工作流)(?![^\s,，：:])\s*[，,：:]*\s*([^\s,，：:]+)(?:\s*[，,：:]*\s*(.*))?$/s;
/**
 * 从渠道消息中解析是否触发工作流
 * @param channel 渠道 ID
 * @param content 消息内容
 * @returns 匹配的工作流及输入内容，不匹配返回 null
 */
export async function parseWorkflowTrigger(channel, content) {
    const trimmed = content.trim();
    const match = trimmed.match(WORKFLOW_CMD_REG);
    if (!match)
        return null;
    const nameOrId = match[1].trim();
    const inputContent = (match[2] || '').trim();
    const workflows = await listWorkflows();
    const eligible = workflows.filter((w) => {
        const msgTrigger = w.triggers?.find((tr) => tr.type === 'message');
        if (msgTrigger && msgTrigger.enabled === false)
            return false;
        if (msgTrigger?.channels && msgTrigger.channels.length > 0 && !msgTrigger.channels.includes(channel)) {
            return false;
        }
        return true;
    });
    let wf = eligible.find((w) => w.id === nameOrId);
    if (!wf) {
        const lower = nameOrId.toLowerCase();
        wf = eligible.find((w) => w.name.toLowerCase() === lower ||
            w.name.toLowerCase().includes(lower) ||
            (w.name.toLowerCase().startsWith(lower) && w.name.length >= nameOrId.length));
    }
    if (!wf)
        return null;
    return {
        workflowId: wf.id,
        workflowName: wf.name,
        inputContent: inputContent || '请执行工作流',
    };
}
//# sourceMappingURL=workflow-router.js.map