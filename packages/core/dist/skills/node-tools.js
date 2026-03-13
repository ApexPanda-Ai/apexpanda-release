/**
 * node-invoke / node-list 工具定义与参数 schema
 * 这两个"虚拟 skill"由 registry 动态注入，无对应 APEX_SKILL.yaml，
 * 因此 schema 集中维护在此文件，由 registry.ts 导入。
 */
/** node-invoke 每个工具的 capability 映射、支持平台与描述 */
export const NODE_INVOKE_TOOLS = [
    { toolId: 'sysRun', capability: 'system.run', platforms: ['headless', 'desktop'], description: '在电脑/服务器执行 Shell 命令（如 dir、ls、npm run），需 Headless 或桌面节点' },
    { toolId: 'batchSysRun', capability: 'system.run', platforms: ['headless', 'desktop'], description: '在多个电脑节点上并发执行同一 Shell 命令' },
    { toolId: 'sysWhich', capability: 'system.which', platforms: ['headless', 'desktop'], description: '在电脑节点查找可执行文件路径（如 which python）' },
    { toolId: 'sysReadFile', capability: 'system.readFile', platforms: ['headless', 'desktop'], description: '在电脑节点读取文件内容（Headless 或桌面节点）' },
    { toolId: 'sysWriteFile', capability: 'system.writeFile', platforms: ['headless', 'desktop'], description: '在电脑节点写入文件（Headless 或桌面节点）' },
    { toolId: 'sysListDir', capability: 'system.listDir', platforms: ['headless', 'desktop'], description: '在电脑节点列出目录内容（Headless 或桌面节点）' },
    { toolId: 'sysClipboardRead', capability: 'system.clipboardRead', platforms: ['desktop'], description: '读取电脑剪贴板内容' },
    { toolId: 'sysClipboardWrite', capability: 'system.clipboardWrite', platforms: ['desktop'], description: '写入电脑剪贴板' },
    { toolId: 'sysProcessList', capability: 'system.processList', platforms: ['headless', 'desktop'], description: '列出电脑节点进程（Headless 或桌面节点）' },
    { toolId: 'sysProcessKill', capability: 'system.processKill', platforms: ['headless', 'desktop'], description: '终止电脑节点指定进程（Headless 或桌面节点）' },
    { toolId: 'cameraSnap', capability: 'camera.snap', platforms: ['desktop', 'android'], description: '拍照：桌面节点=电脑摄像头，Android 节点=手机摄像头' },
    { toolId: 'cameraClip', capability: 'camera.clip', platforms: ['desktop', 'android'], description: '录制短视频（≤60秒）：桌面=电脑摄像头，Android=手机摄像头' },
    { toolId: 'screenRecord', capability: 'screen.record', platforms: ['desktop', 'android'], description: '录屏：桌面=电脑屏幕，Android=手机屏幕' },
    { toolId: 'canvasSnapshot', capability: 'canvas.snapshot', platforms: ['desktop'], description: '桌面 Canvas WebView 截图（仅桌面节点）' },
    { toolId: 'canvasNavigate', capability: 'canvas.navigate', platforms: ['desktop'], description: '桌面 Canvas 打开 URL（仅桌面节点）' },
    { toolId: 'locationGet', capability: 'location.get', platforms: ['android'], description: '获取手机定位（仅 Android 节点，需定位权限）' },
    // UI 自动化：Android=无障碍，desktop=OCR+robotjs（仅 Windows）
    { toolId: 'uiTap', capability: 'ui.tap', platforms: ['android', 'desktop'], description: '点击：按文字（text）或坐标（x,y）点击。Android=无障碍，桌面=OCR+robotjs' },
    { toolId: 'uiInput', capability: 'ui.input', platforms: ['android', 'desktop'], description: '输入文字到当前聚焦的输入框。Android=无障碍，桌面=robotjs 键盘模拟' },
    { toolId: 'uiSwipe', capability: 'ui.swipe', platforms: ['android'], description: '滑动：fromX,fromY → toX,toY' },
    { toolId: 'uiBack', capability: 'ui.back', platforms: ['android'], description: '模拟按返回键' },
    { toolId: 'uiHome', capability: 'ui.home', platforms: ['android'], description: '模拟按 Home 键' },
    { toolId: 'uiDump', capability: 'ui.dump', platforms: ['android', 'desktop'], description: '获取当前界面 UI 树（文字、坐标）。Android=无障碍树，桌面=OCR 元素树' },
    { toolId: 'uiLongPress', capability: 'ui.longPress', platforms: ['android'], description: '长按指定坐标 (x,y)' },
    { toolId: 'uiLaunch', capability: 'ui.launch', platforms: ['android'], description: '按包名启动应用，如 com.tencent.mm（微信）' },
    { toolId: 'screenOcr', capability: 'screen.ocr', platforms: ['android', 'desktop'], description: '截屏+OCR：Android=ML Kit，桌面=Tesseract，返回屏幕文字及坐标，支持中文' },
    { toolId: 'uiAnalyze', capability: 'ui.analyze', platforms: ['android'], description: 'accessibility 树 + OCR 合并输出，一次调用理解完整屏幕' },
    { toolId: 'uiScroll', capability: 'ui.scroll', platforms: ['android'], description: '滚动屏幕：direction 为 up/down/left/right' },
    { toolId: 'uiWaitFor', capability: 'ui.waitFor', platforms: ['android'], description: '等待某文案出现，超时内轮询 accessibility 与 OCR' },
    { toolId: 'uiSequence', capability: 'ui.sequence', platforms: ['android'], description: '批量执行多步：actions 如 [{action:"tap",text:"登录"},{action:"input",text:"xxx"}]' },
];
/** node-invoke 各工具的参数 schema */
export const NODE_INVOKE_PARAMETERS = {
    sysRun: {
        type: 'object',
        properties: {
            command: { type: 'string', description: '要在远程节点执行的 Shell 命令' },
            cwd: { type: 'string', description: '工作目录，可选' },
            env: { type: 'object', description: '环境变量键值对，可选' },
            timeout: { type: 'number', description: '超时毫秒，默认 30000' },
            nodeId: { type: 'string', description: '指定节点 ID，可选，不填则自动选择' },
            nodeName: { type: 'string', description: '按 displayName 匹配节点，如「我的手机」「Build Node」，可选' },
            nodePlatform: { type: 'string', enum: ['headless', 'desktop'], description: '指定节点平台：headless=Linux/无界面服务器(ifconfig/ls)，desktop=Windows/Electron(ipconfig)，可选' },
            nodeTags: { type: 'array', items: { type: 'string' }, description: '指定节点标签过滤，如 ["linux"]，仅选择具备这些标签的节点' },
        },
        required: ['command'],
    },
    batchSysRun: {
        type: 'object',
        properties: {
            command: { type: 'string', description: '要在多个节点执行的 Shell 命令' },
            cwd: { type: 'string', description: '工作目录，可选' },
            env: { type: 'object', description: '环境变量键值对，可选' },
            timeout: { type: 'number', description: '每节点超时毫秒，默认 30000' },
            nodeIds: { type: 'array', items: { type: 'string' }, description: '指定节点 ID 列表，不填则按 nodeTags 或 nodePlatform 或全部节点' },
            nodePlatform: { type: 'string', enum: ['headless', 'desktop'], description: '指定节点平台过滤，可选' },
            nodeTags: { type: 'array', items: { type: 'string' }, description: '指定节点标签，如 ["linux"]，仅在这些标签的节点上执行' },
        },
        required: ['command'],
    },
    sysWhich: {
        type: 'object',
        properties: {
            command: { type: 'string', description: '要查找的可执行文件名，如 node、python' },
            nodeId: { type: 'string', description: '指定节点 ID，可选' },
            nodeName: { type: 'string', description: '按 displayName 匹配节点，可选' },
            nodePlatform: { type: 'string', enum: ['headless', 'desktop'], description: '指定节点平台：headless 或 desktop，可选' },
            nodeTags: { type: 'array', items: { type: 'string' }, description: '节点标签过滤，可选' },
        },
        required: ['command'],
    },
    sysReadFile: {
        type: 'object',
        properties: {
            path: { type: 'string', description: '文件路径，相对工作目录或绝对路径（需在 APEXPANDA_WORKSPACE 内）' },
            encoding: { type: 'string', enum: ['utf8', 'base64'], description: '编码，默认 utf8，二进制文件用 base64' },
            nodeId: { type: 'string', description: '指定节点 ID，可选' },
            nodeName: { type: 'string', description: '按 displayName 匹配节点，可选' },
            nodePlatform: { type: 'string', enum: ['headless', 'desktop'], description: 'headless=Linux/无界面，desktop=Windows/Electron，可选' },
            nodeTags: { type: 'array', items: { type: 'string' }, description: '节点标签过滤，可选' },
        },
        required: ['path'],
    },
    sysWriteFile: {
        type: 'object',
        properties: {
            path: { type: 'string', description: '文件路径' },
            content: { type: 'string', description: '文件内容' },
            encoding: { type: 'string', enum: ['utf8', 'base64'], description: '编码，默认 utf8' },
            nodeId: { type: 'string', description: '指定节点 ID，可选' },
            nodeName: { type: 'string', description: '按 displayName 匹配节点，可选' },
            nodePlatform: { type: 'string', enum: ['headless', 'desktop'], description: 'headless=Linux/无界面，desktop=Windows/Electron，可选' },
            nodeTags: { type: 'array', items: { type: 'string' }, description: '节点标签过滤，可选' },
        },
        required: ['path', 'content'],
    },
    sysListDir: {
        type: 'object',
        properties: {
            path: { type: 'string', description: '目录路径' },
            nodeId: { type: 'string', description: '指定节点 ID，可选' },
            nodeName: { type: 'string', description: '按 displayName 匹配节点，可选' },
            nodePlatform: { type: 'string', enum: ['headless', 'desktop'], description: 'headless=Linux/无界面，desktop=Windows/Electron，可选' },
            nodeTags: { type: 'array', items: { type: 'string' }, description: '节点标签过滤，可选' },
        },
        required: ['path'],
    },
    sysClipboardRead: {
        type: 'object',
        properties: {
            nodeId: { type: 'string', description: '指定节点 ID，可选' },
            nodeName: { type: 'string', description: '按 displayName 匹配节点，可选' },
            nodePlatform: { type: 'string', enum: ['desktop'], description: '仅 desktop 节点支持，可选' },
            nodeTags: { type: 'array', items: { type: 'string' }, description: '节点标签过滤，可选' },
        },
        required: [],
    },
    sysClipboardWrite: {
        type: 'object',
        properties: {
            content: { type: 'string', description: '要写入剪贴板的内容' },
            nodeId: { type: 'string', description: '指定节点 ID，可选' },
            nodeName: { type: 'string', description: '按 displayName 匹配节点，可选' },
            nodePlatform: { type: 'string', enum: ['desktop'], description: '仅 desktop 节点支持，可选' },
            nodeTags: { type: 'array', items: { type: 'string' }, description: '节点标签过滤，可选' },
        },
        required: ['content'],
    },
    sysProcessList: {
        type: 'object',
        properties: {
            nodeId: { type: 'string', description: '指定节点 ID，可选' },
            nodeName: { type: 'string', description: '按 displayName 匹配节点，可选' },
            nodePlatform: { type: 'string', enum: ['headless', 'desktop'], description: 'headless=Linux/无界面，desktop=Windows/Electron，可选' },
            nodeTags: { type: 'array', items: { type: 'string' }, description: '节点标签过滤，可选' },
        },
        required: [],
    },
    sysProcessKill: {
        type: 'object',
        properties: {
            pid: { type: 'number', description: '进程 ID' },
            signal: { type: 'string', enum: ['SIGTERM', 'SIGKILL'], description: '信号，默认 SIGTERM' },
            nodeId: { type: 'string', description: '指定节点 ID，可选' },
            nodeName: { type: 'string', description: '按 displayName 匹配节点，可选' },
            nodePlatform: { type: 'string', enum: ['headless', 'desktop'], description: 'headless=Linux/无界面，desktop=Windows/Electron，可选' },
            nodeTags: { type: 'array', items: { type: 'string' }, description: '节点标签过滤，可选' },
        },
        required: ['pid'],
    },
    cameraSnap: {
        type: 'object',
        properties: {
            facing: { type: 'string', enum: ['front', 'back'], description: '摄像头方向，默认 front' },
            maxWidth: { type: 'number', description: '图片最大宽度，默认 1200' },
            quality: { type: 'number', description: 'JPEG 质量 0-1，可选' },
            nodeId: { type: 'string', description: '指定节点 ID，可选' },
            nodeName: { type: 'string', description: '按 displayName 匹配节点，如「我的手机」，可选' },
        },
        required: [],
    },
    cameraClip: {
        type: 'object',
        properties: {
            duration: { type: 'number', description: '录制秒数，≤60' },
            facing: { type: 'string', enum: ['front', 'back'], description: '摄像头方向' },
            noAudio: { type: 'boolean', description: '不录音频' },
            nodeId: { type: 'string', description: '指定节点 ID，可选' },
            nodeName: { type: 'string', description: '按 displayName 匹配节点，可选' },
        },
        required: [],
    },
    screenRecord: {
        type: 'object',
        properties: {
            duration: { type: 'number', description: '录制秒数，≤60' },
            fps: { type: 'number', description: '帧率，可选' },
            noAudio: { type: 'boolean', description: '不录音频' },
            nodeId: { type: 'string', description: '指定节点 ID，可选' },
            nodeName: { type: 'string', description: '按 displayName 匹配节点，可选' },
        },
        required: [],
    },
    canvasSnapshot: {
        type: 'object',
        properties: {
            format: { type: 'string', enum: ['png', 'jpg'], description: '截图格式' },
            maxWidth: { type: 'number', description: '最大宽度' },
            nodeId: { type: 'string', description: '指定节点 ID，可选' },
        },
        required: [],
    },
    canvasNavigate: {
        type: 'object',
        properties: {
            url: { type: 'string', description: '要打开的 URL' },
            nodeId: { type: 'string', description: '指定节点 ID，可选' },
        },
        required: ['url'],
    },
    locationGet: {
        type: 'object',
        properties: {
            accuracy: { type: 'string', description: '精度要求，可选' },
            maxAge: { type: 'number', description: '缓存最大秒数，可选' },
            nodeId: { type: 'string', description: '指定节点 ID，可选' },
        },
        required: [],
    },
    // UI 自动化（仅 Android）
    uiTap: {
        type: 'object',
        properties: {
            text: { type: 'string', description: '按文字查找并点击，如「发送」「登录」' },
            x: { type: 'number', description: '点击坐标 X（与 text 二选一）' },
            y: { type: 'number', description: '点击坐标 Y（与 text 二选一）' },
            nodeId: { type: 'string', description: '指定节点 ID，可选' },
            nodeName: { type: 'string', description: '按 displayName 匹配节点，如「我的手机」「桌面节点」，可选' },
            nodePlatform: { type: 'string', enum: ['headless', 'desktop', 'android'], description: 'desktop=Windows 桌面（OCR+robotjs），android=手机无障碍，可选' },
        },
        required: [],
    },
    uiInput: {
        type: 'object',
        properties: {
            text: { type: 'string', description: '要输入的文本' },
            nodeId: { type: 'string', description: '指定节点 ID，可选' },
            nodeName: { type: 'string', description: '按 displayName 匹配节点，可选' },
            nodePlatform: { type: 'string', enum: ['desktop', 'android'], description: 'desktop=Windows 键盘模拟，android=手机无障碍，可选' },
        },
        required: ['text'],
    },
    uiSwipe: {
        type: 'object',
        properties: {
            fromX: { type: 'number', description: '起始 X 坐标' },
            fromY: { type: 'number', description: '起始 Y 坐标' },
            toX: { type: 'number', description: '终点 X 坐标' },
            toY: { type: 'number', description: '终点 Y 坐标' },
            duration: { type: 'number', description: '滑动耗时毫秒，默认 300' },
            nodeId: { type: 'string', description: '指定节点 ID，可选' },
            nodeName: { type: 'string', description: '按 displayName 匹配节点，可选' },
        },
        required: ['fromX', 'fromY', 'toX', 'toY'],
    },
    uiBack: {
        type: 'object',
        properties: {
            nodeId: { type: 'string', description: '指定节点 ID，可选' },
            nodeName: { type: 'string', description: '按 displayName 匹配节点，可选' },
        },
        required: [],
    },
    uiHome: {
        type: 'object',
        properties: {
            nodeId: { type: 'string', description: '指定节点 ID，可选' },
            nodeName: { type: 'string', description: '按 displayName 匹配节点，可选' },
        },
        required: [],
    },
    uiDump: {
        type: 'object',
        properties: {
            nodeId: { type: 'string', description: '指定节点 ID，可选' },
            nodeName: { type: 'string', description: '按 displayName 匹配节点，可选' },
            nodePlatform: { type: 'string', enum: ['desktop', 'android'], description: 'desktop=OCR 元素树，android=无障碍树，可选' },
            maxWidth: { type: 'number', description: '桌面 OCR 截图宽度，默认 1920，可选' },
        },
        required: [],
    },
    uiLongPress: {
        type: 'object',
        properties: {
            x: { type: 'number', description: 'X 坐标' },
            y: { type: 'number', description: 'Y 坐标' },
            duration: { type: 'number', description: '长按时长毫秒，默认 500' },
            nodeId: { type: 'string', description: '指定节点 ID，可选' },
            nodeName: { type: 'string', description: '按 displayName 匹配节点，可选' },
        },
        required: ['x', 'y'],
    },
    uiLaunch: {
        type: 'object',
        properties: {
            package: { type: 'string', description: '应用包名，如 com.tencent.mm（微信）、com.ss.android.ugc.aweme（抖音）' },
            nodeId: { type: 'string', description: '指定节点 ID，可选' },
            nodeName: { type: 'string', description: '按 displayName 匹配节点，如「我的手机」，可选' },
        },
        required: ['package'],
    },
    screenOcr: {
        type: 'object',
        properties: {
            maxWidth: { type: 'number', description: '截图最大宽度，默认 1080' },
            includeBase64: { type: 'boolean', description: '是否返回截图 base64' },
            nodeId: { type: 'string', description: '指定节点 ID，可选' },
            nodeName: { type: 'string', description: '按 displayName 匹配节点，如「我的手机」「桌面节点」，可选' },
            nodePlatform: { type: 'string', enum: ['headless', 'desktop', 'android'], description: '指定平台：desktop=Windows 桌面，android=手机，可选' },
            nodeTags: { type: 'array', items: { type: 'string' }, description: '节点标签过滤，可选' },
        },
        required: [],
    },
    uiAnalyze: {
        type: 'object',
        properties: {
            includeBase64: { type: 'boolean', description: '是否包含截图 base64' },
            nodeId: { type: 'string', description: '指定节点 ID，可选' },
        },
        required: [],
    },
    uiScroll: {
        type: 'object',
        properties: {
            direction: { type: 'string', enum: ['up', 'down', 'left', 'right'], description: '滚动方向' },
            nodeId: { type: 'string', description: '指定节点 ID，可选' },
        },
        required: ['direction'],
    },
    uiWaitFor: {
        type: 'object',
        properties: {
            text: { type: 'string', description: '要等待出现的文案' },
            timeout: { type: 'number', description: '超时毫秒，默认 10000' },
            nodeId: { type: 'string', description: '指定节点 ID，可选' },
        },
        required: ['text'],
    },
    uiSequence: {
        type: 'object',
        properties: {
            actions: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        action: { type: 'string', description: 'tap|input|swipe|back|home|longPress|launch|scroll|waitFor' },
                        text: { type: 'string' },
                        x: { type: 'number' }, y: { type: 'number' },
                        fromX: { type: 'number' }, fromY: { type: 'number' }, toX: { type: 'number' }, toY: { type: 'number' },
                        package: { type: 'string' }, direction: { type: 'string' }, timeout: { type: 'number' },
                    },
                },
                description: '动作列表',
            },
            nodeId: { type: 'string', description: '指定节点 ID，可选' },
        },
        required: ['actions'],
    },
};
/** node-list_list 参数 schema */
export const NODE_LIST_PARAMETERS = { type: 'object', properties: {}, required: [] };
//# sourceMappingURL=node-tools.js.map