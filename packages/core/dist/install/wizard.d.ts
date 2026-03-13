export declare function getDataBase(): string;
export interface InstalledMeta {
    installedAt: string;
    version: string;
}
export declare function isInstalled(): boolean;
export declare function getInstalledMeta(): InstalledMeta | null;
export declare function createInstalledLock(version: string): void;
export declare function generateAndWriteApiKey(): string;
export declare function resetInstall(): void;
//# sourceMappingURL=wizard.d.ts.map