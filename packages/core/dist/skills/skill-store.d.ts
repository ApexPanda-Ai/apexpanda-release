export type TrustLevel = 'unverified' | 'testing' | 'trusted' | 'suspended' | 'archived';
export interface ProceduralSkill {
    id: string;
    name: string;
    triggerPhrases: string[];
    scriptPath: string;
    scriptType: 'python' | 'javascript' | 'shell' | 'other';
    description: string;
    successCondition?: string;
    dependencies?: string[];
    platform?: string;
    envSnapshot?: Record<string, string>;
    trustLevel: TrustLevel;
    createdAt: number;
    lastUsedAt: number;
    useCount: number;
    successCount: number;
    successRate: number;
    consecutiveFailures: number;
    archived: boolean;
    tags?: string[];
}
/** 判定路径是否为脚本文件（非目录），目录或无扩展名不参与沉淀 */
export declare function isScriptFilePath(path: string): boolean;
/** 判定路径是否属于 .agent-scripts */
export declare function isAgentScriptPath(path: string): boolean;
/** 从 shell-exec 的 command 中尝试提取 .agent-scripts 脚本路径（仅脚本文件，目录不参与） */
export declare function extractScriptPathFromShellCommand(command: string): string | null;
/** 从工具调用结果中解析脚本路径与 exitCode */
export declare function parseScriptExecutionResult(toolName: string, args: Record<string, unknown>, toolResult: string): {
    scriptPath: string | null;
    exitCode: number;
    stdout?: string;
} | null;
/** 添加新技能（双重校验通过后调用）。目录路径不参与沉淀，返回 null */
export declare function addSkill(opts: {
    scriptPath: string;
    scriptType?: ProceduralSkill['scriptType'];
    name?: string;
    triggerPhrases?: string[];
    description: string;
    successCondition?: string;
    dependencies?: string[];
    platform?: string;
    envSnapshot?: Record<string, string>;
    tags?: string[];
}): Promise<ProceduralSkill | null>;
/** 更新技能执行结果（成功/失败） */
export declare function recordSkillExecution(scriptPath: string, success: boolean): Promise<ProceduralSkill | null>;
/** 标记 90 天未用技能为 archived */
export declare function archiveStaleSkills(): Promise<number>;
/** 检索匹配技能用于 prompt 注入 */
export declare function searchSkillsForPreInjection(userMessage: string, limit?: number, opts?: {
    platform?: string;
}): Promise<Array<{
    skill: ProceduralSkill;
    hint: string;
}>>;
/** 根据 scriptPath 查找技能（用于执行后更新成功率） */
export declare function findSkillByScriptPath(scriptPath: string): Promise<ProceduralSkill | null>;
/** 列举所有过程记忆技能（用于管理 API） */
export declare function listAllProceduralSkills(): Promise<ProceduralSkill[]>;
/** 删除技能 */
export declare function deleteProceduralSkill(id: string): Promise<boolean>;
/** 重置技能（suspended 恢复为 testing，清空连续失败计数） */
export declare function resetProceduralSkill(id: string): Promise<ProceduralSkill | null>;
/** 用户主动更新技能：支持修改 trustLevel（如手动暂停低质量技能）和 tags */
export declare function updateProceduralSkill(id: string, patch: {
    trustLevel?: TrustLevel;
    tags?: string[];
    name?: string;
    description?: string;
}): Promise<ProceduralSkill | null>;
/** 清除内存缓存（测试或重载用） */
export declare function clearSkillStoreCache(): void;
//# sourceMappingURL=skill-store.d.ts.map