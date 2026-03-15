# json-path

按路径从 JSON 提取值，支持点号与数组下标。无需 API Key。

## 工具

### extract

从 JSON 按路径提取值。

**参数：**

- data: JSON 字符串或对象
- path: 路径，如 `data.items[0].name` 或 `result.users.0.email`

**返回：** value、found
