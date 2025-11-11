# GitHub Actions Edgetunnel Sync

自动同步 [cmliu/edgetunnel](https://github.com/cmliu/edgetunnel) 仓库的所有分支，
并在更新时发送 Telegram 通知。

## 使用方法

1. Fork 或创建新仓库
2. 添加 GitHub Secrets：
   - `TELEGRAM_BOT_TOKEN`：你的 Telegram 机器人 Token
   - `TELEGRAM_CHAT_ID`：你的聊天 ID
3. 每天自动运行一次，检测更新并同步所有分支。
