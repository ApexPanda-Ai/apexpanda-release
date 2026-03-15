#!/usr/bin/env node
/**
 * 舆情监测 - 关键词/敏感词检测（CLI 脚本）
 * 平台通过 public-opinion-monitoring#detect 工具调用，本脚本供命令行独立使用
 * 用法: node detect.js --file <path> --keywords="a,b" --sensitive="x" [--source "来源"]
 */
import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { keywords: [], sensitive: [], source: '' };
  const parseList = (s) => (s || '').split(/[,，\n]/).map((x) => x.trim()).filter(Boolean);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--keywords=')) opts.keywords = parseList(a.slice(11));
    else if (a.startsWith('--sensitive=')) opts.sensitive = parseList(a.slice(12));
    else if (a.startsWith('--source=')) opts.source = a.slice(9);
    else if (a === '--file' && args[i + 1]) opts.file = args[++i];
    else if (a === '--text' && args[i + 1]) opts.text = args[++i];
    else if (a === '--keywords' && args[i + 1]) opts.keywords = parseList(args[++i]);
    else if (a === '--keywords-file' && args[i + 1]) opts.keywordsFile = args[++i];
    else if (a === '--sensitive' && args[i + 1]) opts.sensitive = parseList(args[++i]);
    else if (a === '--sensitive-file' && args[i + 1]) opts.sensitiveFile = args[++i];
    else if (a === '--source' && args[i + 1]) opts.source = args[++i];
  }
  return opts;
}

function countMatches(text, word) {
  if (!text || !word) return [];
  const lower = /[a-zA-Z]/.test(word);
  const t = lower ? text.toLowerCase() : text;
  const w = lower ? word.toLowerCase() : word;
  const indices = [];
  let i = 0;
  while ((i = t.indexOf(w, i)) !== -1) {
    indices.push(i);
    i += w.length;
  }
  return indices;
}

function extractContext(text, index, wordLen, radius = 20) {
  return text.slice(Math.max(0, index - radius), Math.min(text.length, index + wordLen + radius)).replace(/\n/g, ' ');
}

function parseList(s) {
  return (s || '').split(/[,，\n]/).map((x) => x.trim()).filter(Boolean);
}

async function readStdin() {
  const rl = createInterface({ input: process.stdin });
  const lines = [];
  for await (const line of rl) lines.push(line);
  return lines.join('\n');
}

async function main() {
  const opts = parseArgs();
  if (opts.keywordsFile) opts.keywords = parseList(await readFile(opts.keywordsFile, 'utf-8'));
  if (opts.sensitiveFile) opts.sensitive = parseList(await readFile(opts.sensitiveFile, 'utf-8'));

  let text = '';
  if (opts.file) text = await readFile(opts.file, 'utf-8');
  else if (opts.text) text = opts.text;
  else text = await readStdin();

  const source = opts.source || (opts.file ? `文件: ${opts.file}` : opts.text ? '粘贴' : 'stdin');
  const summary = text.length > 100 ? text.slice(0, 100) + '...' : text;

  const keywordHits = opts.keywords.map((w) => {
    const indices = countMatches(text, w);
    return { word: w, count: indices.length, firstContext: indices.length ? extractContext(text, indices[0], w.length) : '-' };
  });
  const sensitiveHits = opts.sensitive.map((w) => {
    const indices = countMatches(text, w);
    return { word: w, count: indices.length, firstContext: indices.length ? extractContext(text, indices[0], w.length) : '-' };
  });
  const totalKeyword = keywordHits.reduce((s, h) => s + h.count, 0);
  const totalSensitive = sensitiveHits.reduce((s, h) => s + h.count, 0);

  const lines = [
    '# 舆情监测报告',
    '',
    '## 监测源',
    `- 来源: ${source}`,
    `- 内容摘要: ${summary}`,
    '',
    '## 监测词表',
    `- 关键词: ${opts.keywords.join('、') || '(无)'}`,
    `- 敏感词: ${opts.sensitive.join('、') || '(无)'}`,
    '',
    '## 检测结果',
    '| 类型 | 词汇 | 命中次数 | 首现位置 |',
    '|------|------|----------|----------|',
  ];
  for (const h of keywordHits) lines.push(`| 关键词 | ${h.word} | ${h.count} | ${h.firstContext} |`);
  for (const h of sensitiveHits) lines.push(`| 敏感词 | ${h.word} | ${h.count} | ${h.firstContext} |`);
  lines.push('', '## 敏感预警');
  if (totalSensitive > 0) {
    for (const h of sensitiveHits.filter((h) => h.count > 0)) lines.push(`- **${h.word}** 命中 ${h.count} 次，上下文：\`${h.firstContext}\``);
  } else lines.push('无敏感词命中。');
  lines.push('', '## 摘要', `- 总字符数: ${text.length}`, `- 关键词命中: ${totalKeyword} 次`, `- 敏感词命中: ${totalSensitive} 次`);

  console.log(lines.join('\n'));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
