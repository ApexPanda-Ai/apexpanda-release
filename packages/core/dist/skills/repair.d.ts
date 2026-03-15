export interface RepairInput {
    errorType?: string;
    errorMessage: string;
    filePath?: string;
}
export interface RepairResult {
    suggestedContent?: string;
    diff?: string;
    error?: string;
}
export declare function suggestRepair(skillName: string, input: RepairInput): Promise<RepairResult>;
/** 应用修复：将内容写入 Skill 目录下的指定文件 */
export declare function applyRepair(skillName: string, filePath: string, content: string): Promise<{
    ok: boolean;
    error?: string;
}>;
//# sourceMappingURL=repair.d.ts.map