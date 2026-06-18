# 贡献指南

感谢你对 MCACS V2.0 的关注！我们欢迎各种形式的贡献。

## 行为准则

- 保持尊重和专业
- 建设性讨论技术问题
- 接受不同的观点和方案

## 如何贡献

### 报告 Bug

1. 在 [Issues](https://github.com/wzbis666/MCACS-V2.0/issues) 页面搜索是否已有类似问题
2. 如果没有，创建新 Issue，包含:
   - 运行环境（OS、Node.js 版本、Java 版本、Minecraft 版本）
   - 复现步骤
   - 预期行为 vs 实际行为
   - 相关日志（`journalctl -u minecraft-anticheat -n 50`）

### 功能建议

1. 先在 Issues 中讨论，确认需求合理性
2. 描述功能的使用场景和预期效果
3. 如果涉及检测规则变更，请提供测试数据

### Pull Request 流程

1. Fork 本仓库
2. 创建功能分支: `git checkout -b feature/your-feature`
3. 编写代码并测试
4. 确保 TypeScript 编译通过: `npx tsc --noEmit`
5. 提交前运行 lint: `npx eslint src/`
6. 提交 PR，描述变更内容和原因

### 代码规范

- **TypeScript:** 使用 strict 模式，避免 `any` 类型
- **命名:**
  - 文件名: `kebab-case.ts`
  - 类/接口: `PascalCase`
  - 函数/变量: `camelCase`
  - 常量: `UPPER_SNAKE_CASE`
- **注释:** 公开 API 使用 JSDoc 注释
- **导入:** 使用 ES module 语法，带 `.js` 扩展名

### 检测规则开发

新增检测规则时，请遵循以下流程:

1. 在 `rule-engine.ts` 中添加检测函数
2. 添加对应的 VP 类型和权重配置
3. 在 `penalty-config.yml` 中注册新规则
4. 更新 `src/contracts/` 中的类型定义
5. 如涉及前端展示，更新 `GameProtocol.ts`

### 测试

```bash
# 运行单元测试
npm test

# 编译检查
npx tsc --noEmit

# 前端编译检查
cd town-frontend && npx tsc --noEmit
```

## 项目结构

```
src/plugin/      # 核心检测与处罚引擎
src/bridge/      # 前端桥接与事件翻译
src/contracts/   # 共享类型定义
town-frontend/   # 3D 监控面板
spigot-plugin/   # Minecraft 服务端插件
```

## 问题讨论

- 技术问题: [GitHub Issues](https://github.com/wzbis666/MCACS-V2.0/issues)
- 功能建议: [GitHub Discussions](https://github.com/wzbis666/MCACS-V2.0/discussions)