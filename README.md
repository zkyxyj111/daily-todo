# 每日工作清单 · 使用与部署说明

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/zkyxyj111/daily-todo)

极简每日清单 PWA：到点闹钟提醒（Web Push + 系统日历兜底）、日/周/月循环自动滚动、
完成后划线并默认隐藏、逾期标红累计、连续打卡统计，双手机（iOS / 安卓）云同步。

## 一、文件结构

```
/workspace
├── index.html        前端主页面
├── style.css         样式（浅色/深色主题）
├── app.js            前端逻辑（清单、循环、统计、同步、推送订阅）
├── manifest.json     PWA 配置（可安装到桌面）
├── sw.js             Service Worker（离线缓存 + 推送通知）
├── icon.svg          应用图标
├── seed.html         演示数据入口（会重置本地数据，仅演示用）
└── backend/
    ├── server.js     后端：账号同步 + Web Push 调度 + .ics 日历订阅
    └── package.json
```

## 二、本地试跑

```bash
cd backend && node server.js
# 浏览器打开 http://localhost:3000
# 想看示例数据：打开 http://localhost:3000/seed.html
```

## 三、部署到公网（真机双手机使用的前提）

> Web Push 强制要求 **HTTPS**。另外提醒调度需要**常驻进程**，
> 请使用支持长驻服务的平台（Vercel 的 serverless 函数不适合）。

**最省事**：点本仓库 README 顶部的 **「Deploy to Render」** 按钮 → 用 GitHub 授权登录 Render →
一路点「Create」即可，约 1–2 分钟自动构建出 `https://你的域名`。仓库已自带 `render.yaml` 配置，
无需手动填启动命令。

> 若不用 Render，也可选 Railway / 自有服务器：启动命令均为 `node backend/server.js`，
> 并务必设置环境变量 `DATA_DIR=/var/data` 并挂载一块持久磁盘（否则重启丢数据）。

## 四、两部手机怎么用

1. **iPhone**：Safari 打开网址 → 分享 → 「添加到主屏幕」→ 从主屏幕打开
   （iOS 16.4+ 才支持 PWA 推送，添加到主屏幕是必要步骤）
2. **安卓**：Chrome 打开网址 → 菜单 → 「添加到主屏幕/安装应用」
3. 两部手机都进入 `☰ 设置 → 账号`，**登录同一个邮箱+密码**
   （首次登录即自动注册），清单自动双向同步
4. `☰ 设置 → 开启闹钟提醒`，允许通知权限（两部都开）

## 五、华为手环振动

手环通过「手机系统通知 → 华为运动健康转发」振动，无需额外开发：

- 手机安装/打开**华为运动健康**，蓝牙连接手环
- 运动健康 → 设备 → 消息通知/通知提醒 → 开启，并允许浏览器（Safari/Chrome）的通知转发
- 工作台到点推系统通知 → 手机响 + **手环同步振动**（默认仅到点到一次）

## 六、日历兜底（.ics）

`☰ 设置 → 日历订阅(.ics) → 复制链接`：

- **iPhone**：日历 App → 账户 → 添加订阅日历 → 粘贴链接（系统日历到点也会响+手环振）
- **安卓**：导入 .ics 或用支持订阅的日历应用

## 七、日常功能速览

- 点 `☐` 完成 → 划线并隐藏；底部「显示已完成 N 项」可展开回看（循环任务下周期自动回到清单）
- 逾期任务标红、不消失、累计显示
- 添加任务支持自然语言：`明早9点 吃药`、`每周一 10点 开会`、`每月1号 交房租`
- `☰` 内可设：提醒提前量、勿扰时段、深色主题、数据导出备份
