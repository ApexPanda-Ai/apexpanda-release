/**
 * 活起来 P3: 周期性记忆 consolidation（聚类 → LLM 摘要 → 归档）
 * 拟真「睡眠巩固」：相似记忆合并为更高层语义，源记忆降权
 */
import { getLLMProvider } from '../agent/config.js';
import { selectModel } from '../agent/model-router.js';
import { invokeToolByName } from '../skills/registry.js';
import { getMemoriesForScope, getMemoryScopes, markMemoriesArchived } from '../skills/executor.js';
import { getMemoryConfig } from '../config/loader.js';
const CLUSTER_SIM_THRESHOLD = 0.25;
const MIN_CLUSTER_SIZE = 3;
function bigramSet(s) {
    const str = s.toLowerCase().replace(/\s+/g, '');
    if (str.length === 0)
        return new Set();
    if (str.length === 1)
        return new Set([str]);
    const bg = new Set();
    for (let i = 0; i < str.length - 1; i++)
        bg.add(str.slice(i, i + 2));
    return bg;
}
function bigramSim(a, b) {
    if (a.size === 0 && b.size === 0)
        return 0;
    const inter = [...a].filter((x) => b.has(x)).length;
    return inter / (a.size + b.size - inter);
}
/** 对 scope 内记忆做聚类（Union-Find），相似度 > 阈值的归为一簇 */
function clusterMemories(entries) {
    const active = entries.filter((e) => !e.archived);
    if (active.length < MIN_CLUSTER_SIZE)
        return [];
    const parent = new Map();
    const find = (id) => {
        const p = parent.get(id) ?? id;
        if (p === id)
            return id;
        const root = find(p);
        parent.set(id, root);
        return root;
    };
    const union = (a, b) => {
        const ra = find(a);
        const rb = find(b);
        if (ra !== rb)
            parent.set(ra, rb);
    };
    const texts = new Map(active.map((e) => [e.id, `${e.key ?? ''} ${e.content}`]));
    const bigrams = new Map(active.map((e) => [e.id, bigramSet(texts.get(e.id) ?? '')]));
    for (let i = 0; i < active.length; i++) {
        for (let j = i + 1; j < active.length; j++) {
            const a = active[i];
            const b = active[j];
            if (bigramSim(bigrams.get(a.id), bigrams.get(b.id)) > CLUSTER_SIM_THRESHOLD) {
                union(a.id, b.id);
            }
        }
    }
    const groups = new Map();
    for (const e of active) {
        const root = find(e.id);
        const arr = groups.get(root) ?? [];
        arr.push(e.id);
        groups.set(root, arr);
    }
    return [...groups.values()].filter((g) => g.length >= MIN_CLUSTER_SIZE);
}
async function summarizeCluster(entries, scope) {
    const items = entries.map((e) => `[${e.key ? `${e.key}: ` : ''}${e.content}`).join('\n');
    const prompt = `请将以下多条相似记忆合并为一条简练的语义记忆，保留关键事实与共性，去除冗余细节。输出一行，不超过 80 字。

原始记忆：
${items}

输出（仅一行）：`;
    const model = selectModel(undefined, { messageLength: items.length, historyLength: 0, hasRagContext: false, hasTools: false });
    const llm = getLLMProvider(model);
    const result = await llm.complete([{ role: 'user', content: prompt }], { model, temperature: 0.2 });
    const summary = result.content.trim().replace(/\n/g, ' ').slice(0, 200);
    return summary.length > 5 ? summary : null;
}
export async function runMemoryConsolidation() {
    const cfg = getMemoryConfig();
    if (!cfg.consolidationEnabled || !cfg.persist)
        return 0;
    const scopes = await getMemoryScopes();
    let totalArchived = 0;
    for (const scope of scopes) {
        const entries = await getMemoriesForScope(scope);
        const clusters = clusterMemories(entries);
        for (const ids of clusters) {
            const clusterEntries = entries.filter((e) => ids.includes(e.id));
            if (clusterEntries.length < MIN_CLUSTER_SIZE)
                continue;
            try {
                const summary = await summarizeCluster(clusterEntries, scope);
                if (!summary)
                    continue;
                const key = `consolidated:${Date.now()}`;
                await invokeToolByName('memory#write', { key, content: summary, tier: 'fact', scope }, { sessionId: scope });
                await markMemoriesArchived(scope, ids);
                totalArchived += ids.length;
                console.log(`[Memory Consolidation] ${scope} 归档 ${ids.length} 条 → 1 条摘要`);
            }
            catch (e) {
                console.warn('[Memory Consolidation] 聚类摘要失败', e);
            }
        }
    }
    return totalArchived;
}
//# sourceMappingURL=consolidation.js.map