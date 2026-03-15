declare function getEmbeddingConfig(): {
    baseUrl: string;
    apiKey: string;
    model: string;
};
declare function isEmbeddingEnabled(): boolean;
/**
 * 调用 embedding API，支持单条或批量
 */
export declare function embedTexts(texts: string[]): Promise<number[][]>;
export { getEmbeddingConfig, isEmbeddingEnabled };
//# sourceMappingURL=embedding.d.ts.map