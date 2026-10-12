# workbuddy控制台

WorkBuddy、CodeBuddy IDE、CodeBuddy CLI 与 VS Code CodeBuddy 插件账号切换桌面 App（Tauri），支持国内版 / 国际版，并提供积分到期与 Token 用量监控。

## 功能

| 模块 | 说明 |
| --- | --- |
| 账号管理 | OAuth 扫码登录、导入导出账号、删除账号 |
| 账号切换 | 一键切换 WorkBuddy 登录账号，切换过程实时显示进度 |
| 会话复制 | 把当前账号勾选的会话复制给目标账号，源账号数据不受影响 |
| 关联会话 | 复制过的会话自动建立跨账号关联；支持增量同步、分歧处理与新增 / 解除关联 |
| 积分到期查询 | 自动查询每个账号的积分剩余量与到期时间；7 天内到期高亮 |
| 积分统计 | 汇总官方请求用量：总览、近 30 天趋势、模型分类、账号消耗与请求明细 |
| Token 统计 | 按来源查看 Token 总览与趋势 |
| CodeBuddy CLI | 与 WorkBuddy 复用同一账号库，切换后立即生效 |
| CodeBuddy IDE | 支持切换 CodeBuddy IDE 桌面客户端账号 |
| VS Code CodeBuddy 插件 | 支持切换 VS Code 内的 CodeBuddy 插件账号 |
| JetBrains IDE 插件 | 支持切换 IntelliJ IDEA / PyCharm 内的 CodeBuddy 插件账号 |
| 自动轮换 | 后台把积分最紧迫的账号设为 CodeBuddy CLI 后续启动账号 |
| 权限检测 | macOS 授权引导（App 管理 / 完全磁盘访问） |

## 使用

1. **添加账号**：账号页 →「OAuth 扫码登录」；「导入备份」可恢复 JSON 账号
2. **切换账号**：账号卡片 →「切换」
3. **查看积分**：账号页自动查询，侧栏进入「积分统计」「Token 统计」查看明细
4. **切换各客户端账号**：CodeBuddy CLI / IDE / VS Code 插件均可在账号卡片一键切换

## 许可

[MIT](./LICENSE)
