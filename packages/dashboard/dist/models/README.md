# Agent 3D 沙盘 - 人物模型

此目录存放沙盘使用的人物 GLB 模型。已预置：

**带骨骼/动画：**
- **character1.glb** - CesiumMan（Khronos glTF 示例）
- **character2.glb** - RiggedSimple（Khronos 骨骼示例）
- **character3.glb** - Corset（女性人台）
- **character4.glb** - RiggedFigure（Khronos 绑骨人形）
- **character5.glb** - Fox（狐狸）

**静态/无骨骼（轻量）：**
- **character6.glb** - TranThiNgocTham（hmthanh 人体模型）
- **character7.glb** - body（msorkhpar 人体）
- **character8.glb** - male_base_mesh（BoQsc 男性基础网格，~92KB）

## 添加更多人物模型

1. 下载 CC0/免费 GLB 人物模型，推荐来源：
   - [Quaternius Universal Base Characters](https://quaternius.com/packs/universalbasecharacters.html) - CC0，含多种体型
   - [Poly Pizza](https://poly.pizza/) - 免费 3D 资源
   - [Khronos glTF Sample Assets](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models)

2. 将 `.glb` 文件放入此目录，命名为 `character3.glb`、`character4.glb` 等。

3. 在 `AgentSandbox.tsx` 的 `CHARACTER_MODELS` 数组中追加：
   ```ts
   { id: 'character3', url: '/models/character3.glb', label: '人物 C' },
   ```

4. 在 `Agents.tsx` 的 `AVATAR_MODELS` 中追加对应选项。
