export interface ParsedDiscussion {
    question: string;
    maxRounds: number;
    agentIds: string[];
}
export interface ParseDiscussionOptions {
    defaultRounds?: number;
    maxRounds?: number;
    maxAgents?: number;
}
/**
 * 解析 /debate 或 /讨论 后的内容
 * @returns null 表示未匹配；{ question: '', ... } 且 question 为空表示仅命令无参数（需输出帮助）
 */
export declare function parseDiscussionInput(raw: string, opts?: ParseDiscussionOptions): Promise<ParsedDiscussion | null>;
/** 是否匹配讨论触发命令（含参数或否，支持 ，,：: 作为分隔符） */
export declare function isDiscussionTrigger(msg: string): boolean;
//# sourceMappingURL=parser.d.ts.map