export interface UploadResult {
    name: string;
    requiresConfig: boolean;
    source: 'zip' | 'yaml';
}
/** 同名已存在且未 force 时抛出，供调用方返回 409 */
export declare class SkillExistsError extends Error {
    readonly skillName: string;
    constructor(skillName: string);
}
/** 处理 ZIP 上传 */
export declare function handleZipUpload(buffer: Buffer, force?: boolean): Promise<UploadResult>;
/** 处理 YAML 上传（单文件 APEX_SKILL） */
export declare function handleYamlUpload(buffer: Buffer, force?: boolean): Promise<UploadResult>;
//# sourceMappingURL=upload.d.ts.map