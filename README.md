# dsh-approval-sound

给 **DeepSeek Harness (DSH)** 用的 Windows 审批提示音插件：DSH 需要你出手时响一声，不用一直盯着屏幕。

触发时机只有两个，都是真的在等你：

- **工具请求权限**（同意 / 拒绝）—— 会话事件 `approval/asked`
- **Agent 向你提问**（`ask_user_question`）—— 会话事件 `tool/call`，且工具名为 `ask_user_question`

> 为什么不用 `approval/request` / `user-questions/request`：桌面 Web UI 的 `api-remotes` 应答器会先接管这两个 waterfall，等浏览器真正作答后才返回；插件后注册的监听器要么轮不到，要么等用户点完才响。改用提交后的会话事件，触发时机与审批面板出现同步，不受应答器顺序影响。

> 状态：`0.1.0`，**已发布到 GitHub**（[仓库](https://github.com/liaohongrao/dsh-approval-sound)，[v0.1.0 release](https://github.com/liaohongrao/dsh-approval-sound/releases/tag/v0.1.0)），**未发布 npm**。作者已在 Windows 本地 `desktop` Profile 安装并试听通过（`ask_user_question` 真实触发）；仓库本身不包含安装动作，读者按下方步骤自行安装。发布/安装检查清单见 [PUBLISHING.md](./PUBLISHING.md)。

## 特性

- 每次只响一声，默认使用 Windows UAC 的「叮」（`Windows User Account Control.wav`）
- 800 ms 内的重复触发自动合并，不会连环响
- 只挂 DSH 的 Host 事件，**不读会话日志、不轮询、不需要重启 DSH**
- 提示音文件丢失时自动回退到 `notify.wav`，再不行用系统提示音
- 声音在独立的 Python 进程里用 `winsound` 播放（原因见下文）
- 未启用 / 非 Windows / 播放失败都不会影响审批本身

## 环境要求

| 项目 | 要求 |
| --- | --- |
| 系统 | Windows 10 / 11 |
| DSH | 支持 Cordis Host 插件与 `dsh.bundle.patch` 的版本 |
| Node.js | 22+（DSH 自带，无需单独安装） |
| Python | 3.8+，需要标准库 `winsound`（Windows 官方 Python 自带；DSH 桌面版自带的运行时也可） |

插件会依次找：`pythonPath` 配置 → DSH 自带运行时（`resources\runtime`、`%DSH_HOME%\dsh-runtimes`）→ PATH 上的 `pythonw.exe` / `python.exe` / `py.exe -3`。都没有时退回 PowerShell 播放，但实测在部分沙箱环境下子进程播放可能静音，**建议保留 DSH 自带运行时或装 Python**。

## 安装

> 作者本机已在 Windows 的 `desktop` Profile 安装并试听通过；其他读者按下面步骤自行安装。仓库本身不包含安装动作，也不会自动装进你的 DSH。

1. 把仓库克隆或下载到本地，例如 `D:\tools\dsh-approval-sound`。
2. 在 DSH 里让 Agent 安装这个本地 bundle：
   - 工具：`plugin_manager`
   - `action: install_bundle`
   - `target`: 本目录的**绝对路径**
3. 确认插件已启用，再触发一次审批或提问试听。

如果你机器上还留着 2026-10-27 的旧方案（`.dsh-approval-sound`，计划任务 + Python 守望进程），**先停掉旧的再装**，否则会一声两响：

```text
.dsh-approval-sound\disable-autostart.cmd
.dsh-approval-sound\stop-alarm.cmd
```

## 配置

安装后，插件行 `approval-sound` 的 `config` 支持：

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `enabled` | `true` | 总开关；`false` 时照常加载但不响 |
| `sound` | `C:\Windows\Media\Windows User Account Control.wav` | 主提示音，绝对路径 |
| `fallbackSound` | `C:\Windows\Media\notify.wav` | 主文件不存在时的回退音 |
| `debounceMs` | `800` | 去重窗口（毫秒），最小 150 |
| `pythonPath` | `''` | 指定 `pythonw.exe` / `python.exe`；留空按上面的顺序自动探测 |
| `backend` | `auto` | `auto` / `python` / `powershell` |

示例：

```yaml
- insert:
    - id: approval-sound
      name: dsh-approval-sound
      config:
        sound: 'D:\sounds\ding.wav'
        debounceMs: 1200
```

## 工作原理

```text
DSH Host——提交后的会话事件
  ├─ approval/asked                 ─┐
  └─ tool/call (ask_user_question)  ─┴─▶ index.js（去重 + 选择后端）
                                            │  stdin: 一行 JSON
                                            ▼
                                     sound_player.py --daemon
                                            │  winsound.PlaySound(SND_ASYNC)
                                            ▼
                                         🔊 提示音
```

### 为什么是 Python

Node 没有内置的进程内音频 API。新开一个短命子进程播放 WAV，在 DSH 沙箱下实测是静音的（进程 `exit=0`，但听不到声音）；而 `winsound` 在拥有自己音频会话的进程里播放是有效的。所以：

- `index.js` 只做事件监听、去重和进程管理；
- `sound_player.py` 常驻，收到一行 JSON 就播一次，不写任何 DSH 文件。

这一结论来自 2026-10-27 的原始 `.dsh-approval-sound` 实现与验收记录。本插件把原来的「读 zstd 会话日志 + 轮询」换成了 DSH Host 的 `session/event` 提交后事件，链路上更短，也不再需要计划任务、日志偏移状态和 zstd 解码。

## 与旧方案的区别

| | 旧 `.dsh-approval-sound` | 本插件 |
| --- | --- | --- |
| 触发方式 | 轮询 `session.v4.jsonl.zstd` 日志 | Host `session/event`：`approval/asked` / `ask_user_question` 的 `tool/call` |
| 启动方式 | 注册表自启 + 计划任务 | DSH 插件生命周期 |
| 去重 | 日志偏移 + `events.state.json` | 进程内时间窗 |
| 依赖 | Node + Python | DSH + Python（可选 PowerShell 回退） |
| 安装 | 双击 cmd / 写注册表 | 插件管理器安装，可随时卸载 |

## 自检

```powershell
# 只检查 Python 与音频文件，不播放
python sound\sound_player.py --selfcheck

# 立即播放一次
python sound\sound_player.py --test

# 清单与语法检查
npm test
```

## 已知限制

- 仅支持 Windows；其他平台加载时会直接跳过。
- 需要在 DSH **Host** 进程里加载；只在浏览器/纯 Web 端运行时拿不到 `session/event`。
- 没有 Python 时使用 PowerShell 回退，部分环境可能静音。
- 本版本**未在真实 Profile 中安装验证**（按用户要求不安装），首次安装后请用一次审批/提问确认出声；如果无声，先跑 `--test` 区分「插件没触发」还是「音频设备/文件」问题。
- 不做语音合成（TTS）；本机 SAPI 不可用，提示音固定为 WAV 文件。

## 目录结构

```text
dsh-approval-sound/
├─ index.js                 # Host 插件：监听事件、去重、管理播放器
├─ cordis.patch.yml         # bundle 插入行与默认配置
├─ sound/sound_player.py    # 常驻播放器（winsound）
├─ locale/{zh,en}.json      # 插件管理器显示名与描述
├─ icon.svg                 # 插件图标
├─ test/smoke.mjs           # 清单/入口/语法自检
├─ .github/workflows/check.yml
├─ README.md · CHANGELOG.md · LICENSE
```

## 开发

```powershell
node --check index.js
npm test
python sound\sound_player.py --selfcheck
```

改完 `index.js` 后，已安装的插件需要让 DSH 重新加载（重启或按 DSH 的插件 HMR 规则）。本仓库没有构建步骤。

## License

[MIT](LICENSE)
