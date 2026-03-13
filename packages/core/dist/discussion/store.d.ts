/**
 * 创新模式：讨论状态（内存存储，带 TTL）
 */
import type { WorkflowChannelContext } from '../workflow/types.js';
export interface DiscussionEntry {
    agentId: string;
    agentName: string;
    content: string;
}
export interface DiscussionState {
    mode: 'discussion';
    question: string;
    maxRounds: number;
    agentIds: string[];
    history: DiscussionEntry[];
    currentRound: number;
    startedAt: number;
}
export declare function getSessionKey(channel: string, ctx: WorkflowChannelContext): string;
export declare function hasActiveDiscussion(sessionKey: string): boolean;
export declare function getDiscussionState(sessionKey: string): DiscussionState | undefined;
export declare function setDiscussionState(sessionKey: string, state: DiscussionState): void;
export declare function appendDiscussionEntry(sessionKey: string, entry: DiscussionEntry): void;
export declare function incrementRound(sessionKey: string): void;
export declare function setEndRequested(sessionKey: string): void;
export declare function getEndRequested(sessionKey: string): boolean;
export declare function clearDiscussion(sessionKey: string): void;
/** 定时清理过期讨论状态（供 index 定期调用） */
export declare function cleanupExpiredDiscussions(): void;
//# sourceMappingURL=store.d.ts.map