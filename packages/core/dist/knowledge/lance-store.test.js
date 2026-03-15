/**
 * LanceVectorStore 单元测试
 * 覆盖 upsert、search、delete、clear、维度变更场景
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { LanceVectorStore } from './lance-store.js';
function createTempStore() {
    const dir = mkdtempSync(join(tmpdir(), 'lance-test-'));
    const orig = process.env.APEXPANDA_KNOWLEDGE_LANCE_PATH;
    process.env.APEXPANDA_KNOWLEDGE_LANCE_PATH = join(dir, 'test.lance');
    const store = new LanceVectorStore();
    return {
        store,
        cleanup: () => {
            process.env.APEXPANDA_KNOWLEDGE_LANCE_PATH = orig;
            rmSync(dir, { recursive: true, force: true });
        },
    };
}
const DIM = 4;
describe('LanceVectorStore', () => {
    test('upsert and list', async () => {
        const { store, cleanup } = createTempStore();
        try {
            const chunks = [
                { id: 'c1', content: 'hello', embedding: Array.from({ length: DIM }, (_, i) => 0.1 * (i + 1)), metadata: { source: 'test' } },
                { id: 'c2', content: 'world', embedding: Array.from({ length: DIM }, (_, i) => 0.2 * (i + 1)), metadata: { source: 'test' } },
            ];
            await store.upsert(chunks);
            const list = await store.list();
            assert.strictEqual(list.length, 2);
            assert.strictEqual(list.find((c) => c.id === 'c1')?.content, 'hello');
            assert.strictEqual(list.find((c) => c.id === 'c2')?.content, 'world');
        }
        finally {
            cleanup();
        }
    });
    test('search (keyword fallback)', async () => {
        const { store, cleanup } = createTempStore();
        try {
            await store.upsert([
                { id: 'c1', content: 'hello world', metadata: {} },
                { id: 'c2', content: 'foo bar', metadata: {} },
            ]);
            const results = await store.search('hello', 5);
            assert.ok(results.length >= 1);
            assert.ok(results.some((c) => c.content.includes('hello')));
        }
        finally {
            cleanup();
        }
    });
    test('delete', async () => {
        const { store, cleanup } = createTempStore();
        try {
            await store.upsert([
                { id: 'c1', content: 'a', metadata: {} },
                { id: 'c2', content: 'b', metadata: {} },
            ]);
            await store.delete(['c1']);
            const list = await store.list();
            assert.strictEqual(list.length, 1);
            assert.strictEqual(list[0].id, 'c2');
        }
        finally {
            cleanup();
        }
    });
    test('clear', async () => {
        const { store, cleanup } = createTempStore();
        try {
            await store.upsert([{ id: 'c1', content: 'x', metadata: {} }]);
            await store.clear();
            const list = await store.list();
            assert.strictEqual(list.length, 0);
        }
        finally {
            cleanup();
        }
    });
    test('vectorSearch', async () => {
        const { store, cleanup } = createTempStore();
        try {
            const vec = Array.from({ length: DIM }, (_, i) => (i === 0 ? 1 : 0));
            await store.upsert([
                { id: 'c1', content: 'first', embedding: vec, metadata: {} },
                { id: 'c2', content: 'second', embedding: Array.from({ length: DIM }, () => 0), metadata: {} },
            ]);
            const results = await store.vectorSearch(vec, 2);
            assert.ok(results.length >= 1);
            assert.ok(results.some((c) => c.id === 'c1'));
        }
        finally {
            cleanup();
        }
    });
    test('维度不一致时拒绝写入', async () => {
        const { store, cleanup } = createTempStore();
        try {
            await store.upsert([
                { id: 'c1', content: 'a', embedding: Array.from({ length: DIM }, () => 0), metadata: {} },
            ]);
            await assert.rejects(async () => {
                await store.upsert([
                    { id: 'c2', content: 'b', embedding: Array.from({ length: DIM + 1 }, () => 0), metadata: {} },
                ]);
            }, /向量维度不一致/);
        }
        finally {
            cleanup();
        }
    });
});
//# sourceMappingURL=lance-store.test.js.map