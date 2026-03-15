/**
 * Skill 模版 ZIP 生成
 * 供 /skills 页「下载 Skill 模版」使用，符合迁移方案 Section 7 的 parameters 规范
 * 包含 APEX_SKILL.yaml + scripts/ 目录，支持自定义脚本执行
 */
import AdmZip from 'adm-zip';
const TEMPLATE_YAML = `# ============================================================
# APEX Skill 技能定义文件
# 完整文档见：docs/技能参数Schema迁移方案.md
# ============================================================

# 技能名称，只能包含字母、数字、下划线、连字符。会作为目录名和工具前缀（如 my-skill_invoke）
name: my-skill

# 版本号，语义化即可
version: 1.0.0

# 技能简介，供 LLM 理解何时调用本技能。建议写明适用场景、用户意图关键词
description: 自定义技能模板，含 scripts/ 目录，可编写 Python/Node/Bash 脚本。上传 ZIP 后即可使用

author: ApexPanda
license: MIT

# 权限声明（必须显式声明，否则无权限）。常用：process/spawn 执行脚本、filesystem/read 读文件、network/outbound 访问外网
permissions:
  - id: process
    scope: spawn
    description: 执行 scripts/ 目录下的脚本

# 工具列表，每个工具对应一个 LLM 可调用的 function
tools:
  - id: invoke
    # 工具描述，LLM 据此判断何时调用。可写用户说法示例，如「用户说 XXX 时调用」
    description: 调用自定义脚本。command 为传给脚本的参数（如 --mode=query --input=xxx）
    # handler：openclaw-legacy#invoke 表示执行 scripts/main.py 等脚本；也可用 file-tools#readFile 等内置 handler
    handler: openclaw-legacy#invoke
    # parameters 为 JSON Schema，供 LLM 正确传参。必须有 type、properties、required
    parameters:
      type: object
      properties:
        command:
          type: string
          description: 传给 scripts/main.py 的参数字符串，如 --input=hello 或 JSON 等
      required: [command]

# 兼容性声明
compatibility:
  apexAgent: ">=0.1.0"
  openClaw: true

# 以下为可选字段（可取消注释使用）：
# category: 其他          # Skills 页分类，如 数据/计算、企业协作
# envFields:              # 需配置的 env 变量，Skills 页会显示表单
#   - key: API_KEY
#     label: API 密钥
#     type: password
# defaultParams:          # Skills 测试页的默认参数（toolId -> JSON 字符串）
#   invoke: '{"command":"--input=hello"}'
`;
/** scripts/main.py - 可替换为 run.sh、index.js 等，见 executor findOpenClawScript */
const SCRIPTS_MAIN_PY = `#!/usr/bin/env python3
"""
自定义 Skill 脚本示例
平台调用时会将 command 参数字符串传入，可通过 sys.argv[1] 获取
可修改为任意业务逻辑：调用 API、读写文件、数据处理等
"""
import sys
import json

def main():
    command = sys.argv[1] if len(sys.argv) > 1 else ""
    # 示例：若 command 为 JSON，解析并处理
    try:
        data = json.loads(command) if command.strip().startswith("{") else {"raw": command}
        result = {"received": data, "message": "Hello from my-skill script"}
    except json.JSONDecodeError:
        result = {"received": command, "message": "Hello from my-skill script"}
    print(json.dumps(result, ensure_ascii=False))

if __name__ == "__main__":
    main()
`;
const README = `# my-skill 模版

## 目录结构

- APEX_SKILL.yaml  # 技能定义，含 tools、parameters、permissions
- scripts/        # 可执行脚本目录
  - main.py       # 主脚本（可改为 run.sh、index.js、run.py 等）

## 支持的脚本

平台按以下顺序查找并执行（见 findOpenClawScript）：
scripts/main.py | scripts/run.py | scripts/index.js | scripts/run.sh
或根目录：<name>.py | main.py | run.py | index.js | run.sh

## 上传

打包本目录为 ZIP，在 Skills 页「上传 ZIP/YAML」上传。
`;
/** 生成符合迁移方案的 Skill 模版 ZIP Buffer（含 scripts/） */
export function buildSkillTemplateZip() {
    const zip = new AdmZip();
    zip.addFile('APEX_SKILL.yaml', Buffer.from(TEMPLATE_YAML, 'utf-8'));
    zip.addFile('scripts/main.py', Buffer.from(SCRIPTS_MAIN_PY, 'utf-8'));
    zip.addFile('README.md', Buffer.from(README, 'utf-8'));
    return zip.toBuffer();
}
//# sourceMappingURL=template-zip.js.map