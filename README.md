# 每日工作清单 · 无服务器版（部署与说明）

极简每日清单：到点闹钟提醒（系统日历 .ics）、日/周/月循环自动滚动、完成划线+隐藏、逾期标红、双手机云同步、华为手环振动。

**本版本已改为「无服务器」架构**：纯静态网页 + Supabase 云数据库，无需自建后端、无需绑定任何信用卡。

---

## 一、你已完成的（不用再动）

- ✅ GitHub 仓库：`https://github.com/zkyxyj111/daily-todo`
- ✅ Supabase 项目已创建（地址 `https://sjefpfgprwruiarifdnn.supabase.co`）

---

## 二、在 Supabase 建一张数据表（一次性，约 1 分钟）

1. 打开你的 Supabase 项目 → 左侧 **SQL Editor** → **New query**
2. 粘贴下面这段 → 点 **Run**：

```sql
create table if not exists public.user_data (
  user_id uuid primary key references auth.users(id) on delete cascade,
  tasks jsonb not null default '[]'::jsonb,
  history jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now()
);
alter table public.user_data enable row level security;
drop policy if exists "own row" on public.user_data;
create policy "own row" on public.user_data
  for all to anon, authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
```

3. （重要）关闭注册邮箱验证：左侧 **Authentication → Providers → Email**，
   把 **Confirm email** 关掉。否则首次注册后必须验证邮箱才能登录。

> 验证建表是否成功：再开一个 New query，跑 `select * from user_data;` 应返回空表、不报错。

---

## 三、开启 GitHub Pages（静态托管，免卡）

1. 打开 `https://github.com/zkyxyj111/daily-todo` → **Settings → Pages**
2. **Build and deployment → Source** 选 **Deploy from a branch**
3. **Branch** 选 `main` / 目录 `/(root)` → **Save**
4. 等 1–2 分钟，你会得到网址：`https://zkyxyj111.github.io/daily-todo/`

（国内访问 GitHub Pages 可能偏慢，但你的关键闹钟走手机本地日历，不受此影响。）

---

## 四、两部手机使用

1. 两部手机都用浏览器打开上面的 Pages 网址
   - **iPhone**：Safari 打开 → 分享 → **添加到主屏幕**
   - **安卓**：Chrome 打开 → 菜单 → **安装应用 / 添加到主屏幕**
2. 都进 `☰ 设置 → 账号`，**用同一个邮箱登录**（首次即自动注册），清单自动双向同步
3. **设置日历闹钟**：`☰ → 日历闹钟(.ics) → 下载导入`
   - iOS：把下载的 `每日清单.ics` 用「文件」App 打开 → 导入到日历
   - 安卓：用日历 App 导入该文件
   - 导入后，到点**手机响 + 手环振动**（系统日历通知会经蓝牙转发给手环）
4. 任务有变动时，重新点一次「下载导入」刷新日历即可

---

## 五、功能说明

| 功能 | 说明 |
|---|---|
| 添加任务 | `＋` → 支持自然语言：`明早9点 吃药` / `每周一 10点 开会` / `每月1号 交房租` |
| 完成 | 点左边圆圈 → 划线变灰、自动隐藏；循环任务滚到下一周期 |
| 显示已完成 | 底部「显示已完成 N 项」点开回看，再点收起 |
| 逾期 | 过点没做自动标红、不消失、累计显示 |
| 日/周/月 | 每天同时刻 / 指定星期几 / 指定日期（月末取当月最后一天） |
| 统计 | `☰ → 完成统计`：今日完成率、连续打卡、近 7 天 |
| 手环振动 | 由系统日历通知经蓝牙转发，无需单独对接 |
| 应用内提醒 | `☰ → 应用内提醒` 授权后，App 打开时到点弹系统通知（关 App 不触发，靠日历兜底） |

---

## 六、数据与安全

- 任务存于你的 Supabase 免费库，登录同一邮箱即恢复，换机不丢
- 前端只用 Supabase 的 **anon 公钥**，配合行级安全（RLS）策略，每个用户只能读写自己的数据
- 想备份：`☰ → 数据备份 → 导出 JSON`

---

## 技术架构

```
浏览器(静态页) ──Supabase JS REST/Auth──▶ Supabase(免费云库)
        │
        └──生成 .ics 日历文件──▶ 手机系统日历──▶ 手环振动
```

前端：`index.html` `style.css` `app.js` `sw.js`（离线缓存/可安装）
托管：GitHub Pages（静态，免卡）
数据/账号：Supabase（免费，无需信用卡）
提醒：客户端生成的 `.ics`（系统级，关 App 也响）
