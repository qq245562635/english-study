# 部署到 Cloudflare（开启云端同步）

全程免费，大约 10 分钟。

1. **注册账号**：打开 https://dash.cloudflare.com/sign-up ，用邮箱注册免费账号。
2. **从 GitHub 导入**：左侧菜单进入 **Workers & Pages** → **Create** → 选 **Import a repository**（导入仓库）→ 连接 GitHub，选择 `english-study` 仓库。
   - 构建命令（Build command）留空。
   - 部署命令（Deploy command）保持默认的 `npx wrangler deploy`。
   - 点 **Deploy**。第一次部署时会自动创建保存进度用的 KV 存储。
3. **设置同步密码**：部署完成后，打开这个 Worker → **Settings** → **Variables and Secrets** → **Add**：
   - Type 选 **Secret**
   - Name 填 `SYNC_TOKEN`
   - Value 填一个只有你知道的密码（建议 12 位以上，字母加数字）
   - 保存。
4. **打开网页**：网址类似 `https://english-study.你的子域名.workers.dev`，在 Worker 页面上能看到。
5. **开启同步**：在网页的“我的”页面输入刚才的密码，点“开启同步”。每台设备只需要输入一次。

> 换网址后浏览器里的旧记录不会自动带过来：先在旧网址（GitHub Pages）的“我的”页面点“导出记录”，再到新网址点“导入记录”，然后开启同步。

以后每次推送到 GitHub 的 `main` 分支，Cloudflare 会自动重新部署。

如果第 2 步部署失败、提示 KV namespace 缺少 id：在 **Storage & Databases → KV** 里新建一个叫 `english-study-progress` 的 namespace，把它的 ID 填进 `wrangler.toml` 里 `binding = "PROGRESS"` 下面一行：`id = "这里填 ID"`，再重新部署。
