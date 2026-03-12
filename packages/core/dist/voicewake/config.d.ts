export interface VoiceWakeConfig {
    enabled?: boolean;
    triggerWords?: string[];
    language?: string;
    silenceTimeout?: number;
    hardStopTimeout?: number;
    debounce?: number;
    soundEnabled?: boolean;
    targetAgentId?: string | null;
    replyMode?: 'tts' | 'text';
    /** 浏览器端识别方式：browser=Web Speech API(需访问Google)，server=服务端飞书ASR(国内可用) */
    recognitionMode?: 'browser' | 'server';
}
export declare function loadVoiceWakeConfig(): Promise<VoiceWakeConfig>;
export declare function saveVoiceWakeConfig(config: Partial<VoiceWakeConfig>): Promise<VoiceWakeConfig>;
//# sourceMappingURL=config.d.ts.map