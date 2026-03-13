export class MemoryVectorStore {
    chunks = new Map();
    async list() {
        return Array.from(this.chunks.values());
    }
    async clear() {
        this.chunks.clear();
    }
    async upsert(docs) {
        for (const d of docs) {
            this.chunks.set(d.id, { ...d });
        }
    }
    async search(query, topK = 5) {
        const q = query.toLowerCase();
        const scored = Array.from(this.chunks.values()).map((c) => {
            const content = (c.content ?? '').toLowerCase();
            let score = 0;
            for (const word of q.split(/\s+/)) {
                if (word && content.includes(word))
                    score += 1;
            }
            return { ...c, score };
        });
        scored.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
        return scored.slice(0, topK).filter((c) => (c.score ?? 0) > 0);
    }
    async delete(ids) {
        for (const id of ids)
            this.chunks.delete(id);
    }
}
//# sourceMappingURL=memory-store.js.map