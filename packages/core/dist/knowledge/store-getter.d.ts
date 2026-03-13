import type { VectorStore } from './types.js';
/**
 * 默认使用 LanceDB 持久化存储，防止重启数据丢失。
 * 设置 APEXPANDA_KNOWLEDGE_PERSIST=false 可切换为内存模式（开发/测试用）。
 * 设置 APEXPANDA_HYBRID_SEARCH_ENABLED=false 可回退到旧版（LanceDB + 可选外部 Embedding API）。
 */
export declare function getKnowledgeStore(): VectorStore;
//# sourceMappingURL=store-getter.d.ts.map