# Spotify Daily Playlist Automation

这是一个云端自动化，不是完整 App。它每天按 Montreal 时间早上 6 点运行，自动把固定的 Spotify 歌单改名并替换内容，例如：

- `5.8适合深夜开车歌单`
- `5.8emo歌单`
- `5.8情歌歌单`
- `5.8快节奏歌单`

实现方式是复用同一批 Spotify playlist：第二天会把昨天的歌单改名成新日期，并替换歌曲，不会每天无限创建新歌单。

## 当前 MVP 场景

- `late_night_drive`：适合深夜开车
- `emo`：emo
- `love_songs`：情歌
- `fast_paced`：快节奏

## 推荐规则

- 同一个 artist 在同一张歌单最多 5 首。
- 不做“7 天绝对不重复”。高偏好、收藏、重复播放的歌可以在 2 天左右冷却后重新出现。
- 普通歌曲默认 4 天冷却，探索歌曲默认 6 天冷却。
- Spotify 最近播放、收藏、Top tracks/artists 会提高权重。
- 用户从自动歌单里手动移除的歌，下一次运行会被观察到并降低权重。
- 每个场景保留一定探索比例，避免全是旧歌。
- Spotify Audio Features 目前在官方文档中标注为 deprecated，所以默认不依赖它；如果你之后仍想试用，可以把 `ENABLE_SPOTIFY_AUDIO_FEATURES=true`。

## 一次性设置

### 1. 创建 Supabase

在 Supabase SQL Editor 里运行：

```sql
-- copy and run supabase/schema.sql
```

需要保存两个值到 GitHub Secrets：

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

### 2. 创建 Spotify Developer App

去 Spotify Developer Dashboard 创建应用，并添加 Redirect URI：

```text
http://127.0.0.1:8888/callback
```

保存：

- `SPOTIFY_CLIENT_ID`
- `SPOTIFY_CLIENT_SECRET`

不要把 Spotify 账号密码发给任何人。这里使用 OAuth，只需要你授权一次。

### 3. 获取 Spotify refresh token

本地创建 `.env`，填入：

```text
SPOTIFY_CLIENT_ID=...
SPOTIFY_CLIENT_SECRET=...
SPOTIFY_REDIRECT_URI=http://127.0.0.1:8888/callback
```

生成授权链接：

```bash
npm run auth:url
```

打开链接并同意授权。浏览器可能显示 localhost 连接失败，这是正常的；从地址栏复制 `code=` 后面的值，或者复制完整 URL。

交换 refresh token：

```bash
npm run auth:exchange "PASTE_CODE_OR_FULL_REDIRECT_URL_HERE"
```

把输出的 refresh token 保存到 GitHub Secrets：

- `SPOTIFY_REFRESH_TOKEN`

### 4. 配置 GitHub Actions Secrets

在仓库 Settings -> Secrets and variables -> Actions 里添加：

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
SPOTIFY_CLIENT_ID
SPOTIFY_CLIENT_SECRET
SPOTIFY_REFRESH_TOKEN
```

### 5. 云端定时

`.github/workflows/daily-spotify-playlists.yml` 会每小时触发一次，但脚本只在 Montreal 时间早上 6 点真正执行。这样不用处理夏令时切换。

你也可以在 GitHub Actions 页面手动点 `Run workflow`，默认会强制立即跑一次。

## 本地测试

```bash
npm run check
FORCE_RUN=true npm run daily
```

Windows PowerShell:

```powershell
$env:FORCE_RUN="true"; npm run daily
```

## 重要说明

- 云端自动化运行后，你的电脑可以关机。
- Spotify 密码不需要提供，也不应该提供。
- 这个 MVP 没有前端页面，反馈主要来自 Spotify 行为：最近播放、收藏、Top items，以及你从自动歌单中手动移除的歌曲。
- 如果未来要记录“跳过”这种更精确行为，需要增加播放器轮询或一个轻量反馈入口。
