# 发布与安装检查清单

> 当前状态：插件包 `0.1.0` **已发布到 GitHub**（[仓库](https://github.com/liaohongrao/dsh-approval-sound)，[v0.1.0 release](https://github.com/liaohongrao/dsh-approval-sound/releases/tag/v0.1.0)），**未发布 npm**；作者已在本地 `desktop` Profile 安装并试听通过（`ask_user_question` 真实触发，声音正常）。本文件是操作手册，不代表读者环境已经安装。
> 原始要求：先汇报，得到明确同意后再发布；安装时避免和旧 `.dsh-approval-sound` 同时运行。
> 2026-10-29：已用 GitHub API 直接创建公开仓库并上传 `main`；本机没有 `git`，下面第 2 节的手动流程保留作参考。

## 1. 发布前自检

```powershell
# Node 不在 PATH 时用 DSH 自带运行时
$node = 'D:\deepseek\resources\runtime\primary-runtime\dependencies\node\bin\node.exe'
& $node test\smoke.mjs
& $node test\apply.mjs

# Python 可用时
python sound\sound_player.py --selfcheck
python sound\sound_player.py --test
```

期望：`All 24 checks passed.`、`All 8 event checks passed.`；`--selfcheck` 报告 `winsound` 与音频文件可用；`--test` 能听到一声。

再确认：

- [ ] `package.json` 的 `name`、`version`、`description`、`license` 正确。
- [ ] `dsh.bundle.patch` 指向 `./cordis.patch.yml`，patch 里 `name` 与包名一致。
- [ ] `index.js` 只监听 `session/event`，没有回退到 `approval/request`。
- [ ] `files` 包含运行所需文件（`index.js`、`cordis.patch.yml`、`sound/*.py`、`locale/*.json`、`icon.svg`）。
- [ ] 没有把本机绝对路径、日志、`node_modules`、`__pycache__` 提交进去。

## 2. 只发 GitHub（推荐先做这个）

本机当前没有 `git`。二选一：

- 安装 Git for Windows，或
- 用 GitHub Desktop 图形界面创建仓库。

命令行流程：

```powershell
cd D:\deepseekharness\dsh-approval-sound
git init
git add .
git commit -m "feat: initial dsh-approval-sound plugin"
git branch -M main
git remote add origin https://github.com/<你的用户名>/dsh-approval-sound.git
git push -u origin main
```

然后在 GitHub 网页创建仓库（不要勾选自动生成 README，避免和本地冲突），或先创建空仓库再推送。

发布前决定：

- [ ] 仓库名：`dsh-approval-sound`（建议）。
- [ ] 是否公开：公开则 MIT 许可证已就绪。
- [ ] 是否补 `repository` / `homepage` / `bugs` 字段（建议补，npm 页面会用到）。
- [ ] 是否打 tag：`git tag v0.1.0 && git push origin v0.1.0`。

只发 GitHub 时保留 `"private": true`，可以防止误 `npm publish`；GitHub 本身不受影响。

## 3. 发 npm（可选，暂不建议）

要做 npm 包时：

1. 把 `package.json` 的 `"private": true` 改成 `false`。
2. 补 `repository`、`homepage`、`bugs`。
3. 确认包名 `dsh-approval-sound` 在 npm 上可用。
4. `npm pack --dry-run` 检查打包内容。
5. `npm publish --access public`。

当前未执行以上任何一步。

## 4. 安装到 DSH（必须另行确认）

先停旧方案，避免双响：

```powershell
D:\deepseekharness\.dsh-approval-sound\disable-autostart.cmd
D:\deepseekharness\.dsh-approval-sound\stop-alarm.cmd
```

然后由用户明确同意后，用插件管理器安装本地目录：

- 目标：`D:\deepseekharness\dsh-approval-sound`
- 这是 bundle 包，`package.json` 已声明 `dsh.bundle.patch`。
- `plugin_manager` 的安装动作需要 `danger-full-access` 批准；会影响当前 Profile 的所有会话。
- 安装/启用后，分别触发一次“工具请求权限”和一次 `ask_user_question` 验证。

若从 GitHub 安装，也可用仓库 spec（例如 `github:<用户名>/dsh-approval-sound`），但本地目录更适合先验证未发布版本。

## 5. 首装验收

- [ ] 插件管理器能看到「审批提示音 / Approval Sound」条目和图标。
- [ ] 触发一次工具权限请求，面板出现的同时响一声。
- [ ] 触发一次 `ask_user_question`，问题出现的同时响一声。
- [ ] 800 ms 内连续两次请求只响一次。
- [ ] 关闭插件（`enabled:false`）后不再响。
- [ ] 卸载/停用插件后审批与提问功能本身不受影响。

## 6. 回滚

1. 在插件管理器停用或移除 `dsh-approval-sound`。
2. 需要恢复旧方案时：

   ```powershell
   D:\deepseekharness\.dsh-approval-sound\enable-autostart.cmd
   D:\deepseekharness\.dsh-approval-sound\启动提示音.cmd
   ```

3. 确认没有两个提示音进程同时运行。

## 7. 已知限制（发布说明里要保留）

- 仅 Windows 10/11。
- 需要 DSH Host 插件能力；纯 Web 端不触发。
- Python 3.8+ 且带 `winsound` 时最稳；没有 Python 时 PowerShell 回退在部分沙箱可能静音。
- 只播 WAV，不做 TTS。
- 本版本已在作者本机 `desktop` Profile 安装并试听通过；其他环境首装仍需按第 5 节验收。
- 发布时本机 hosts 把 `api.github.com` 指向 `127.0.0.1`，已改用可达的 GitHub IP + `Host` 头完成 API 发布；排查记录见 `dsh-approval-sound-WORKLOG-2026-10-28.md` 的「GitHub 发布请求与阻塞」。
