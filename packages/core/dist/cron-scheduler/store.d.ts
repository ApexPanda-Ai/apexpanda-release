export interface CronTask {
    id: string;
    cron: string;
    command: string;
    description?: string;
    workspaceDir?: string;
    createdAt: number;
    lastRunAt?: number;
}
export interface CronStore {
    tasks: CronTask[];
}
export declare function getCronSchedulerStore(): CronStore;
export declare function addScheduledTask(store: CronStore, task: CronTask): Promise<void>;
export declare function listScheduledTasks(store: CronStore): Promise<CronTask[]>;
export declare function removeScheduledTask(store: CronStore, id: string): Promise<void>;
export declare function ensureCronRunnerStarted(): void;
//# sourceMappingURL=store.d.ts.map