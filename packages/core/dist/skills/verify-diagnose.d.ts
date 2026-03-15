export interface VerifyResult {
    ok: boolean;
    error?: string;
}
export declare function verifySkill(skillName: string): Promise<VerifyResult>;
export interface DiagnoseToolResult {
    id: string;
    invokable: boolean;
    error?: string;
}
export interface DiagnoseResult {
    loadable: boolean;
    envConfigured?: boolean;
    tools: DiagnoseToolResult[];
    error?: string;
}
export declare function diagnoseSkill(skillName: string): Promise<DiagnoseResult>;
//# sourceMappingURL=verify-diagnose.d.ts.map