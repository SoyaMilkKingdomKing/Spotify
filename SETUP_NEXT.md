# 下一步部署清单

## 你现在需要在浏览器里完成

### 1. GitHub

1. 在打开的 GitHub 页面创建一个新仓库。
2. 建议仓库名：`spotify-daily-playlist-automation`
3. 先不要勾选 README、.gitignore、license。
4. 创建后，把仓库页面 URL 发给我。

### 2. Supabase

1. 创建一个新项目。
2. 进入 SQL Editor。
3. 运行本项目里的 `supabase/schema.sql`。
4. 进入 Project Settings -> API，准备这两个值：
   - `Project URL`
   - `service_role key`

### 3. Spotify Developer

1. 创建一个 App。
2. Redirect URI 填：

```text
http://127.0.0.1:8888/callback
```

3. 准备这两个值：
   - `Client ID`
   - `Client Secret`

## 不建议发到聊天里的内容

下面这些是敏感配置。不要发 Spotify 密码；这些 key 也最好不要直接发到聊天里。

```text
Supabase Project URL:
Supabase service_role key:
Spotify Client ID:
Spotify Client Secret:
```

我已经创建了本地 `.env` 文件。你可以把上面的值直接填进 `.env`，这个文件不会被提交到 GitHub。

GitHub repo URL 可以发给我，因为它不是 secret。

你填完 `.env` 后告诉我，我会继续：

1. 配本地 `.env`
2. 生成 Spotify 授权链接
3. 让你在浏览器授权一次
4. 换取 refresh token
5. 推送代码到 GitHub
6. 配置 GitHub Actions secrets
7. 手动跑一次验证
