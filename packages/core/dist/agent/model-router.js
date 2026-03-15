/**
 * 模型路由：简单任务 → 廉价模型，复杂任务 → 主模型
 */
import { getLLMModel } from '../config/loader.js';
const SIMPLE_MSG_MAX_CHARS = 200;
const SIMPLE_MSG_WITH_TOOLS_MAX = 120; // 短消息+工具有时也是单意图（如「打开百度」「xx天气」）
const SIMPLE_HISTORY_MAX = 3;
export function isModelRoutingEnabled() {
    return process.env.APEXPANDA_MODEL_ROUTING_ENABLED === 'true';
}
export function getSimpleTaskModel() {
    return process.env.APEXPANDA_MODEL_SIMPLE ?? 'gpt-4o-mini';
}
export function getComplexTaskModel() {
    return getLLMModel();
}
/** 判断是否为简单任务（可用廉价模型） */
export function isSimpleTask(opts) {
    if (!isModelRoutingEnabled())
        return false;
    if (!process.env.APEXPANDA_MODEL_SIMPLE?.trim())
        return false;
    if (opts.historyLength > SIMPLE_HISTORY_MAX)
        return false;
    if (opts.hasRagContext)
        return false;
    if (opts.hasTools) {
        return opts.messageLength <= SIMPLE_MSG_WITH_TOOLS_MAX;
    }
    return opts.messageLength <= SIMPLE_MSG_MAX_CHARS;
}
/** 根据任务复杂度选择模型 */
export function selectModel(agentModel, opts) {
    if (agentModel)
        return agentModel;
    return isSimpleTask(opts) ? getSimpleTaskModel() : getComplexTaskModel();
}
//# sourceMappingURL=model-router.js.map