export async function retrieve(config, query) {
    const { vectorStore, topK = 5, rerank } = config;
    let chunks = await vectorStore.search(query, topK);
    if (rerank && chunks.length > 0) {
        chunks = await rerank(query, chunks);
    }
    return chunks;
}
export function buildContext(chunks) {
    if (chunks.length === 0)
        return '';
    return chunks
        .map((c, i) => {
        const src = c.metadata?.source || c.id;
        return `[${i + 1}] (来源: ${src})\n${c.content}`;
    })
        .join('\n\n---\n\n');
}
/** 构建引用来源列表，供前端展示 */
export function buildSources(chunks) {
    return chunks.map((c) => ({
        id: c.id,
        content: c.content.slice(0, 200) + (c.content.length > 200 ? '...' : ''),
        source: c.metadata?.source,
    }));
}
//# sourceMappingURL=rag.js.map