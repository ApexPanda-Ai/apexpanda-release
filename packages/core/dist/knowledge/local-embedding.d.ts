/** 模型是否已加载完成 */
export declare function isEmbeddingReady(): boolean;
/** 后台预加载模型，不阻塞 */
export declare function preloadEmbedding(): void;
/** 获取向量维度 */
export declare function getEmbedDim(): number;
/**
 * 批量生成文本向量
 * @param texts 文本列表
 * @param isQuery 若为 true，对 query 加 BGE 检索前缀
 */
export declare function embedTexts(texts: string[], isQuery?: boolean): Promise<number[][]>;
//# sourceMappingURL=local-embedding.d.ts.map