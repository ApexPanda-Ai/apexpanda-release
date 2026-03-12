/**
 * 工作流定时触发器
 * 扫描配置了 cron trigger 的工作流，按 cron 表达式定时执行
 * 定时结果推送：优先使用工作流自带的 outputChannelContext（渠道创建时自动填充），
 * 否则使用全局 workflows.cronOutput 配置
 */
import cron from 'node-cron';
import { listWorkflows } from './store.js';
import { getWorkflow } from './store.js';
import { runWorkflow } from './engine.js';
import { getWorkflowCronOutputConfig } from '../config/loader.js';
const jobs = new Map();
function isValidCron(expr) {
    try {
        cron.validate(expr);
        return true;
    }
    catch {
        return false;
    }
}
export async function refreshWorkflowCronScheduler() {
    const workflows = await listWorkflows();
    const toRemove = new Set(jobs.keys());
    for (const wf of workflows) {
        const cronTrigger = wf.triggers?.find((t) => t.type === 'cron');
        if (!cronTrigger || cronTrigger.enabled === false || !cronTrigger.expression)
            continue;
        if (!isValidCron(cronTrigger.expression)) {
            console.warn(`[Workflow] Invalid cron "${cronTrigger.expression}" for workflow ${wf.id}`);
            continue;
        }
        const key = wf.id;
        toRemove.delete(key);
        const existing = jobs.get(key);
        if (existing) {
            existing.stop();
            jobs.delete(key);
        }
        const task = cron.schedule(cronTrigger.expression, async () => {
            try {
                const def = await getWorkflow(wf.id);
                if (!def)
                    return;
                const channelCfg = def.outputChannelContext ?? getWorkflowCronOutputConfig();
                await runWorkflow(def, { message: `定时触发 @ ${new Date().toISOString()}`, workflowName: def.name }, {
                    channelContext: channelCfg ?? undefined,
                });
                console.log(`[Workflow] Cron executed: ${wf.name} (${wf.id})`);
            }
            catch (e) {
                console.error(`[Workflow] Cron run failed: ${wf.name}`, e);
            }
        });
        jobs.set(key, task);
        console.log(`[Workflow] Cron scheduled: ${wf.name} (${wf.id}) "${cronTrigger.expression}"`);
    }
    for (const id of toRemove) {
        const task = jobs.get(id);
        if (task) {
            task.stop();
            jobs.delete(id);
            console.log(`[Workflow] Cron unscheduled: ${id}`);
        }
    }
}
export function stopWorkflowCronScheduler() {
    for (const task of jobs.values())
        task.stop();
    jobs.clear();
    console.log('[Workflow] Cron scheduler stopped');
}
//# sourceMappingURL=scheduler.js.map