/**
 * 知识库存储获取（单例，避免循环依赖）
 */
import { getHybridSearchEnabled } from '../config/loader.js';
import { MemoryVectorStore } from './memory-store.js';
import { LanceVectorStore } from './lance-store.js';
import { HybridSearchStore } from './hybrid-store.js';
import { wrapWithEmbeddingIfEnabled } from './embedding-store.js';
let instance = null;
/**
 * 默认使用 LanceDB 持久化存储，防止重启数据丢失。
 * 设置 APEXPANDA_KNOWLEDGE_PERSIST=false 可切换为内存模式（开发/测试用）。
 * 设置 APEXPANDA_HYBRID_SEARCH_ENABLED=false 可回退到旧版（LanceDB + 可选外部 Embedding API）。
 */
export function getKnowledgeStore() {
    if (!instance) {
        if (getHybridSearchEnabled()) {
            instance = new HybridSearchStore();
        }
        else {
            const base = process.env.APEXPANDA_KNOWLEDGE_PERSIST !== 'false'
                ? new LanceVectorStore()
                : new MemoryVectorStore();
            instance = wrapWithEmbeddingIfEnabled(base);
        }
    }
    return instance;
}
//# sourceMappingURL=store-getter.js.map