#!/usr/bin/env node
/**
 * 生成公众号测试用封面图
 * 运行（项目根目录）: node packages/skills/builtin/wechat-mp-publish/scripts/gen-cover.js
 * 输出: packages/skills/builtin/wechat-mp-publish/assets/cover.jpg
 * uploadThumb 传 path: "packages/skills/builtin/wechat-mp-publish/assets/cover.jpg"
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '..', 'assets');
const outPath = join(outDir, 'cover.jpg');

async function main() {
  mkdirSync(outDir, { recursive: true });
  // 封面需 2.35:1 比例（如 940×400），900×500 易触发「尺寸不合法」
  const res = await fetch('https://picsum.photos/940/400');
  if (!res.ok) throw new Error(`获取图片失败: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(outPath, buf);
  console.log('已生成:', outPath, '(' + Math.round(buf.length / 1024) + 'KB)');
  console.log('uploadThumb 传: {"path":"packages/skills/builtin/wechat-mp-publish/assets/cover.jpg"}');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
