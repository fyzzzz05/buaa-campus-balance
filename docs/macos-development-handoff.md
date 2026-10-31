# macOS 版开发交接

本文档描述 **当前 macOS 版「校园余额」的实际开发方式**：代码在哪、每个进程/文件负责什么、怎么改、怎么构建、怎么测试、怎么发布，以及容易踩的坑。

> 适用版本：`VERSION = 1.1.4`（提交 `56ddcdf`）。
> 同一工作区里还有 Windows 版（Electron，`electron/`，复用本仓库的 `public/` 与 `lib/`），见文末「与 Windows 版的关系」。

---

## 0. 三十秒速览

| 项目 | 事实 |
| --- | --- |
| UI 技术 | **HTML/CSS/JS**（`public/index.html`、`public/dashboard.html`），不是 SwiftUI |
| 外壳 | AppKit + `WKWebView`（`desktop/main.swift`，约 240 行） |
| 数据层 | 纯 Swift 子进程 `CampusServer`，只监听 `127.0.0.1` 随机端口，HTTP + JSON |
| 进程模型 | `CampusBalance`（GUI）→ 子进程 `CampusServer`（数据/接口）→ 学校服务 |
| 数据库 | 无。JSON 文件 + macOS 钥匙串 |
| 构建 | `./desktop/build.sh`（无小组件）/ `./desktop/widget/build-with-widget.sh`（完整发布形态） |
| 发布 | GitHub Actions 打 tag `vX.Y.Z` → 只上传 **DMG**，无 ZIP / 无 appcast |
| 签名 | 仅 ad-hoc（`codesign --sign -`），**未公证**，首次打开会被 Gatekeeper 拦 |
| 系统要求 | Apple 芯片 Mac，macOS 13.5+（小组件要 macOS 14+） |
| 测试 | `npm test`（JS）+ `./tests/run-native.sh`（Swift） |

**最重要的认知**：这个 App 的「页面」就是仓库里的两个 HTML 文件。改布局/配色/动效基本等于改 Web；Swift 只负责登录、抓数据、缓存、小组件和窗口壳。

---

## 1. 架构

```
┌───────────────────────────── CampusBalance.app ─────────────────────────────┐
│                                                                             │
│  Contents/MacOS/CampusBalance   ← main.swift：窗口 + WKWebView + 菜单        │
│        │  ① 启动子进程，把一次性 secret 从 stdin 传入                         │
│        ▼                                                                     │
│  Contents/Resources/CampusServer ← native/*.swift 编译：登录/抓数/接口/缓存   │
│        │  ② 随机端口监听 127.0.0.1，stdout 打印 "READY <port>"                │
│        ▼                                                                     │
│  WKWebView  load http://127.0.0.1:<port>/   （加载 Resources/app/public/*）   │
│        │  ③ 页面里 fetch("/api/...") 打到同一个本地端口                       │
│        ▼                                                                     │
│  学校服务（cc-pay / zfw / mall / shsd / sso）——只在 CampusServer 里访问       │
│                                                                             │
│  Contents/PlugIns/CampusBalanceWidget.appex ← SwiftUI 小组件（只读快照）      │
│  后台：LaunchAgent CampusWidgetBridge（常驻）+ CampusWidgetRefresh（每天 8:30）│
└─────────────────────────────────────────────────────────────────────────────┘
```

要点：

- **所有学校请求都在 Swift 里**（`SchoolHTTP` 统一超时、响应大小、重定向白名单），WebView 从不直接访问学校域名；唯一例外是「学校统一认证」用了 WebView 跳转，登录成功后把 cookie 收集起来 POST 回本地 `/api/auth`（见 §6.3）。
- WebView 使用 `.nonPersistent()` 数据存储，学校 cookie 不落盘；本地会话用一次性 cookie `campus_native_session=<sessionToken>`。
- `CampusServer` 的 lifecycle 绑在 App 上：App 退出会 `terminate` 它；父进程死掉它自己 15 秒内退出。

---

## 2. 目录与职责

```
public/index.html         登录页（结构 + CSS + 少量 JS，全部 UI 在此）
public/dashboard.html     仪表盘（设计 token、图表、动效、对话框，全部在此）
api/*.js                  Vercel/浏览器网页版的服务端接口（Mac App 不使用）
lib/*.js                  同上，网页版共享的登录/抓数/诊断/小组件逻辑
dev.js                    本机网页模式服务器（127.0.0.1:4173/4174）
start-web.command         双击启动网页模式（macOS Keychain 存会话 secret）
desktop/
  main.swift              App 外壳（窗口、菜单、WKWebView、SSO、URL scheme、子进程管理）
  Info.plist              Bundle 配置（版本号运行时注入、URL scheme、ATS 例外）
  build.sh                「无小组件」构建入口
  make-icon.swift         SVG → iconset（图标生成）
  prepare-sparkle.sh      下载并校验 Sparkle 2.10.1 到 ~/Library/Caches/CampusBalance
  assets/campus-balance-icon.svg   应用图标源文件（唯一权威）
  native/                 数据层（详见下表）
  widget/                 SwiftUI 小组件 + 完整构建脚本
tests/
  *.test.js               网页版逻辑测试（node:test）
  native/main.swift       Swift 数据层断言式测试
  run-native.sh           编译并运行原生测试 + 小组件 bridge 测试
.github/workflows/
  release.yml             打 tag 后构建 DMG 并发布
  windows-electron.yml    Windows（Electron）构建与 win-v* 发布
VERSION                   版本号唯一来源，如 1.1.4
```

`desktop/native/` 明细：

| 文件 | 作用 |
| --- | --- |
| `NativeServer.swift` | 本地 HTTP 服务：路由 `/`、`/api/auth`、`/api/data`、`/api/data/part`、`/api/settings`；会话校验；小组件快照发布 |
| `NativeDashboard.swift` | 把 4 个指标（card/net/lighting/air）组装成页面要的 JSON；自动重新登录；电费逐项兜底 |
| `SchoolClient.swift` | 学校接口：SSO 表单登录、cookie 登录、校园卡余额/流水、校园网余额/流水 |
| `SchoolHTTP.swift` | URLSession + 重定向白名单（`cc-pay/mall/pass/zfw/sso`，仅 https、无端口）+ 大小限制 |
| `SchoolHTML.swift` | 学校页面解析（登录表单、流量表、流量明细分页） |
| `CampusHistory.swift` | 消费/流量分页累加器（余额变化、充值不计入消费） |
| `Electricity.swift` | 电表：HTTPS→HTTP 回退、字段别名、表号/类型校验、GitHub 历史 CSV |
| `CardFallback.swift` | 流水失败时按「相邻日期余额差」估算每日消费 |
| `LocalSettings.swift` | 按账号隔离的电表设置 + Keychain 自动登录密码（`CampusKeychain`） |
| `Diagnostics.swift` | 诊断日志（`~/Library/Logs/CampusBalance/diagnostics.ndjson`）与错误码/文案 |
| `RefreshBatches.swift` | 同一次刷新 4 个分片都到齐才发布小组件快照，避免旧批次覆盖 |
| `WidgetSnapshots.swift` | 调 `CampusWidgetSnapshot` 写快照文件 |
| `WidgetAgents.swift` | 安装/校验/卸载两个 LaunchAgent（bridge 常驻 + 每天 8:30 刷新） |
| `WidgetRefresh.swift` | 每日后台刷新入口（从钥匙串取密码，balanceOnly 刷新） |
| `WidgetBridge.swift` | 小组件只读桥：`127.0.0.1:49771/snapshot`，Bearer token 校验 |

---

## 3. 两条运行通路

| | macOS App | 网页模式（Vercel / 本机浏览器） |
| --- | --- | --- |
| 入口 | `desktop/main.swift` → `CampusServer` | `dev.js`（本机）或 Vercel Functions（`api/*.js`） |
| API 实现 | Swift（`NativeServer.swift`） | Node（`api/auth.js`、`api/data.js`、`api/settings.js`） |
| 页面 | 同一份 `public/*.html` | 同一份 `public/*.html` |
| 页面如何区分 | `main.swift` 注入 `window.__campusNative = true` | 变量不存在 |
| 数据抓取节奏 | `/api/data/part?part=card\|net\|electricity` 三路并发 | `/api/data` 一次给全量 |
| 登录状态 | 本地进程内 + `campus_native_session` cookie | AES-GCM 加密的分片 cookie `campus_session` |
| 自动登录密码 | 钥匙串（Swift） | 钥匙串（Node，`lib/credentials.js`） |

改页面时要注意这个分支：`public/dashboard.html` 里 `refresh()` 会判断 `window.__campusNative`。新增接口时**两条通路都要实现**（Swift 的 `NativeServer` 和 Node 的 `api/*.js`），否则网页版或 App 会有一边缺功能。

网页模式需要环境变量（`.env.example`）：

```sh
ALLOWED_USER_ID=        # 可选，限制只允许某个账号
SESSION_SECRET=         # 必填，>=32 字符；start-web.command 会自动生成并 stdin 传入
NETWORK_AUTH_SAME_PASSWORD=false
```

`start-web.command` 会生成/复用 `~/Library/Application Support/CampusBalance/web-session-key`（600），打开 <http://127.0.0.1:4174>。

---

## 4. 开发环境

必需：

- **Apple 芯片 Mac**（构建脚本硬编码 `arm64-apple-macosx13.5`）。
- **完整版 Xcode**（`/Applications/Xcode.app`）：小组件要用 `xcodebuild` 和 App Intents 元数据；`build.sh` 只需要 `swiftc`/`swift`/`iconutil`/`codesign`/`PlistBuddy`。
- 第一次构建需要网络：`prepare-sparkle.sh` 会下载 Sparkle 2.10.1（校验 SHA256）到 `~/Library/Caches/CampusBalance/Sparkle-2.10.1`；`npm ci` 需要 npm 源（仅网页模式/JS 测试需要）。
- **不需要** Apple Developer 账号：全流程 ad-hoc 签名。
- 调试学校接口需要能访问学校服务的网络和一个真实账号（有验证码时只能走「学校统一认证」网页登录）。

可选：Node.js 22+（只用于网页模式和 `npm test`，Mac App 本身不依赖 Node）。

---

## 5. 日常开发循环

> 下面命令默认在**仓库根目录**（含 `desktop/`、`public/`、`VERSION` 的那一层）执行。

### 5.1 只改页面（最常见）

页面资源是在构建时 **复制进 .app** 的（`Contents/Resources/app/public/`），所以改 HTML/CSS 有三种速度：

1. **最快**：在已构建的 App 里原地替换，然后在窗口里 `⌘R` 重新加载：
   ```sh
   APP="$PWD/../校园余额-v1.1.4.app"
   cp -R public/. "$APP/Contents/Resources/app/public/"
   ```
2. **看真实数据**（推荐）：改完 `public/` 后重新跑完整构建（Swift 编译 + 复制，通常几秒）：
   ```sh
   rm -rf ../校园余额-v1.1.4.app && ./desktop/build.sh && open ../校园余额-v1.1.4.app
   ```
3. **只调样式/布局、不想登录学校**：`./start-web.command`，浏览器开 `http://127.0.0.1:4174`。注意网页模式的数据源是 Node，字段与 App 一致但抓取节奏不同，涉及 `window.__campusNative` 的分支要用方式 1/2 验证。

### 5.2 改 Swift 数据层

```sh
# 1) 先跑原生断言测试（几秒）
./tests/run-native.sh
# 2) 构建 App
rm -rf ../校园余额-v1.1.4.app && ./desktop/build.sh
# 3) 启动（可直接在终端跑，能看到 server 的 stderr/stdout 问题）
open ../校园余额-v1.1.4.app
```

> `build.sh` 在输出已存在时会**直接报错退出**，重建前必须删掉旧产物。

### 5.3 调试

- **查询失败**：App 菜单「帮助 → 打开诊断日志」定位 `~/Library/Logs/CampusBalance/diagnostics.ndjson`；每行一个 JSON（`time/code/stage/message/endpoint/scheme/port/field/httpStatus/transportCode`），256 KiB 轮转，保留 `.1`。
- **性能日志**：Swift 用 `Logger(subsystem:"edu.buaa.campusbalance")` 打点（登录、每个 data part 的耗时）：
  ```sh
  log stream --predicate 'subsystem == "edu.buaa.campusbalance"' --level info
  ```
- **App 起不来/白屏**：在终端运行 `.../CampusBalance.app/Contents/MacOS/CampusBalance` 看输出；`CampusServer` 的失败会让 App 弹 `NSAlert`。
- **本地服务协议**：`CampusServer` 启动时 stdout 打印 `READY <port>`；打印后 App 才 load WebView。手工调试时可临时把 `CAMPUS_PARENT_PID` 去掉让它不因父进程退出而退。

### 5.4 改小组件

- UI 只在 `desktop/widget/CampusBalanceWidget.swift`。
- 用 Xcode 打开 `desktop/widget/CampusBalanceWidget.xcodeproj` 做预览/调试；发版前必须走完整构建：
  ```sh
  rm -rf ../校园余额-v1.1.4.app && ./desktop/widget/build-with-widget.sh
  ```
- 本地验证组件：先 App 内登录并勾选「保存密码，自动重新登录」（这会安装两个 LaunchAgent），再在桌面添加小组件；快照文件是 `~/Library/Application Support/CampusBalance/widget-snapshot.json`。
- 彻底清理后台任务：
  ```sh
  launchctl bootout "gui/$(id -u)/edu.buaa.campusbalance.widget-refresh" 2>/dev/null
  launchctl bootout "gui/$(id -u)/edu.buaa.campusbalance.widget-bridge" 2>/dev/null
  rm -f ~/Library/LaunchAgents/edu.buaa.campusbalance.widget-*.plist
  rm -f ~/Library/Application\ Support/CampusBalance/widget-account.json
  ```

---

## 6. 运行期细节

### 6.1 启动顺序（`desktop/main.swift`）

1. 建窗口 1050×720（最小 340×560），配菜单（App/文件/编辑/窗口/帮助），装 `WKWebView`（nonPersistent + 注入 `window.__campusNative`）。
2. 生成 32 字节一次性 secret，启动 `CampusServer`，secret 走 stdin，`CAMPUS_PARENT_PID` 用于父进程守护。
3. 读子进程 stdout 的 `READY <port>`，`web.load(http://127.0.0.1:<port>/)`。
4. 关闭窗口不退出（Dock 点回来 `makeKeyAndOrderFront`）；`⌘Q` 才退出并 terminate 子进程。

### 6.2 本地 HTTP 接口（`NativeServer.swift`）

| 方法/路径 | 说明 |
| --- | --- |
| `GET /`、`/index.html`、`/dashboard`、`/dashboard.html` | 返回 `Resources/app/public/*.html` |
| `GET /api/auth` | 是否已登录（cookie 校验） |
| `POST /api/auth` | `{username,password,networkSamePassword,autoLogin}` 登录；`{action:"logout"}` 退出；`{action:"school-session",cookies:[...]}` 导入学校 cookie（需 header `X-Campus-Native-Token`，且不能带 Origin） |
| `GET/POST /api/settings` | 读/写当前账号的照明/空调电表号等 |
| `GET /api/data` | 一次性返回 4 个指标（网页模式兼容路径） |
| `GET /api/data/part?part=card\|net\|electricity&batch=<uuid>` | 分片刷新；4 片齐了才发布小组件快照 |

约束（安全相关，改代码时别放松）：只接受 `Host: 127.0.0.1:<port>`；写接口校验 `Origin`；请求头 ≤8 KiB、body ≤10 KiB、请求总量 ≤20 KiB；学校请求统一走 `SchoolHTTP` 白名单。

单个指标 JSON 形状（页面按此渲染）：

```jsonc
{
  "status": "ok" | "unavailable" | "login_required",
  "value": 26.87, "unit": "元", "note": "当前余额",
  "history": [{ "date": "2026-10-20", "value": 19.93 }],
  "records": [{ "label": "…", "date": "…", "value": "¥…" }],
  "historyNote": "校园卡消费 · 元",
  "historySource": "transactions",
  "diagnostic": { "code": "…", "stage": "…", "message": "…" },
  "historyDiagnostic": { … }, "fallbackDiagnostic": { … }, "transportDiagnostic": { … }
}
```

### 6.3 学校统一认证（SSO）

1. 登录页按钮在 App 内被 `main.swift` 拦截：`/sso/start` → 在同一 WebView 打开 `https://www.cc-pay.cn/login?channel=BUAASSO`。
2. 期间只允许 `cc-pay / pass / mall / sso` 域名的 https 导航；其它链接交给系统浏览器。
3. 到达 cc-pay 域名后，收集 WebView cookie，POST 到本地 `/api/auth`（带一次性 native token），`CampusServer` 用 `loginWithCookies` 建立会话；App 再把本地会话 cookie 写回 WebView，跳 `/dashboard`。
4. 网页登录不产出密码 ⇒ 不启用自动登录，也不启用校园网同密码登录。

### 6.4 本机数据与凭据

| 内容 | 位置 | 权限 |
| --- | --- | --- |
| 电表设置 | `~/Library/Application Support/CampusBalance/users/<sha256(user)>.json` | 600 |
| 自动登录密码 | 钥匙串：service `edu.buaa.campus-balance.auto-login`，account=学号 | 系统管理 |
| 校园卡余额估算兜底 | 同目录 `card-balance-<sha256>.json` | 600 |
| 小组件账号配置 | 同目录 `widget-account.json` | 600 |
| 小组件快照 | 同目录 `widget-snapshot.json` | 600 |
| 小组件桥 token | App 内 `Contents/Resources/widget-token`（并写入 appex Info.plist） | 600 |
| 诊断日志 | `~/Library/Logs/CampusBalance/diagnostics.ndjson` | 600，256 KiB 轮转 |
| 网页模式会话 key | `~/Library/Application Support/CampusBalance/web-session-key` | 600 |

退出登录会：删钥匙串密码（若开了自动登录）→ 卸载 LaunchAgent → 清小组件快照 → 清本地会话。

### 6.5 小组件与后台刷新

- 小组件是独立沙盒 appex（`com.apple.security.app-sandbox` + `network.client`），**拿不到** App 的钥匙串和学校 cookie，只能通过本机 bridge 读快照。
- `CampusWidgetBridge`（常驻 KeepAlive）监听 `127.0.0.1:49771`，校验 `Authorization: Bearer <appex Info.plist 中的 CampusWidgetToken>`；快照 ≤4096 字节。
- `CampusWidgetRefresh`（每天 08:30 + RunAtLoad）从 `widget-account.json` + 钥匙串登录，`dashboard.refresh(balanceOnly:true)`，再通过 `CampusWidgetSnapshot` 写快照并 `WidgetCenter.reloadTimelines`。
- 新旧快照合并：本次某项 `value == null` 时保留上次成功值，备注标为「更新失败」（`SnapshotMerge.swift`）。
- 只有当「自动重新登录」勾选时才安装后台任务；`WidgetAgents.matches` 会比较 App 内可执行文件路径、调度、token 路径等，**移动/升级 App 后旧 agent 会被重建**（下次登录时）。

---

## 7. 构建与产物

### 7.1 两种构建

```sh
# 仅 App（无小组件），产物默认在仓库上一级目录
./desktop/build.sh
# 等价于显式指定输出：
./desktop/build.sh /tmp/校园余额-v1.1.4.app

# 完整发布形态（App + 小组件 + bridge + snapshot helper + 权限/签名）
./desktop/widget/build-with-widget.sh /tmp/校园余额-v1.1.4.app
```

`APP_VERSION` 可覆盖 `VERSION`：

```sh
APP_VERSION=1.1.5 ./desktop/widget/build-with-widget.sh /tmp/校园余额-v1.1.5.app
```

### 7.2 `build.sh` 做了什么

1. 校验版本号格式，计算 `CFBundleVersion = major*1000000 + minor*1000 + patch`。
2. `prepare-sparkle.sh` 准备（缓存）Sparkle 2.10.1，把 `Sparkle.framework` 拷进 `Contents/Frameworks`。
3. 复制 `desktop/Info.plist` 并用 `PlistBuddy` 写入版本号；复制 `public/` → `Contents/Resources/app/public/`。
4. `make-icon.swift` 从 SVG 生成 iconset → `iconutil` 生成 `AppIcon.icns`。
5. 用 `swiftc` 分别编译 `CampusServer`、`CampusWidgetRefresh`（无小组件构建也会编译，便于后续替换）。
6. 编译 `main.swift`（链接 Sparkle/AppKit/WebKit/Security，rpath 指向 `../Frameworks`）。
7. `codesign --force --deep --sign -`（ad-hoc）。

### 7.3 `build-with-widget.sh` 额外步骤

1. `xcodebuild` 编译 `CampusBalanceWidget` target（`ARCHS=arm64`，`CODE_SIGNING_ALLOWED=NO`），并断言存在 `Metadata.appintents`。
2. 调 `build.sh` 产 App。
3. 拷 `CampusBalanceWidget.appex` 到 `Contents/PlugIns/`。
4. 编译 `CampusWidgetBridge`（`WidgetBridge.swift`）与 `CampusWidgetSnapshot`（`SnapshotMerge.swift` + `WriteWidgetSnapshot.swift`）。
5. 生成 32 字节 hex `widget-token`（600）并写入 appex 的 `CampusWidgetToken`。
6. 分级签名：appex 用 `Widget.entitlements`（沙盒+网络），App 用 `Shared.entitlements`（App Group `group.edu.buaa.campusbalance`），最后 `codesign --verify --deep --strict`。

### 7.4 产物结构（排查时很有用）

```
校园余额-v1.1.4.app/Contents/
  MacOS/CampusBalance
  Resources/CampusServer
  Resources/CampusWidgetRefresh
  Resources/CampusWidgetBridge
  Resources/CampusWidgetSnapshot
  Resources/widget-token
  Resources/app/public/index.html
  Resources/app/public/dashboard.html
  Resources/AppIcon.icns
  Frameworks/Sparkle.framework
  PlugIns/CampusBalanceWidget.appex
  Info.plist
```

---

## 8. 测试

```sh
# 网页版逻辑（node:test，无需学校账号）
npm ci
npm test

# 原生数据层 + 小组件 bridge（需要 Xcode 的 swiftc）
./tests/run-native.sh
```

- `npm test` 覆盖：会话 cookie 封装、设置校验、数据组装、诊断日志脱敏、流水分页、小组件 agent/bridge/refresh/snapshot。
- `tests/run-native.sh` 用合成响应断言：消费分页与充值不计入、流量分页与单位、重定向白名单、登录表单/流量表/明细解析、电费 CSV 与表号匹配、设置读写与账号隔离、LaunchAgent 复用判断；随后编译 `WidgetBridge` 并用 `CAMPUS_NATIVE_BRIDGE=<二进制> node --test tests/widget-bridge.test.js` 测 token/越权。
- 新增解析逻辑时：Swift 侧在 `tests/native/main.swift` 加 `check(...)`；JS 侧在 `tests/*.test.js` 加 `test(...)`。

调试用的编译开关：`CAMPUS_TESTING`（`SchoolHTTP`/`SchoolClient` 导出 cookie 帮助测试）、`CAMPUS_ISOLATED_TEST`（`NativeServer` 禁止自动登录/跳过快照发布）。发版构建不定义它们。

---

## 9. 版本与发布

### 9.1 版本号

- 唯一来源是根目录 `VERSION`（`x.y.z`）。构建脚本把它写入 `CFBundleShortVersionString`，并算出 `CFBundleVersion`。
- 发版前同步更新 `docs/releases/vX.Y.Z.md`（Release 说明，纯文本一段话即可，参考 `docs/releases/v1.1.4.md`）。

### 9.2 发布流程（GitHub Actions）

`.github/workflows/release.yml`：push tag `v*.*.*` 触发，`macos-14` runner：

1. `npm ci` → `npm test` → `./tests/run-native.sh`
2. `APP_VERSION=<tag 去掉 v> ./desktop/widget/build-with-widget.sh "$RUNNER_TEMP/校园余额-v$VERSION.app"`
3. `codesign --verify --deep --strict`，断言 appex 内有 `Metadata.appintents`
4. `hdiutil create ... -format UDZO` 生成 `CampusBalance-vX.Y.Z-macOS-arm64.dmg`（附 `/Applications` 软链）
5. `gh release create <tag> --draft`（有 `docs/releases/<tag>.md` 就用它，否则 `--generate-notes`）→ 只上传 DMG → `gh release edit --draft=false --latest`

发布纪律（来自 `AGENTS.md`，务必遵守）：

- **只上传 DMG**，不上传 ZIP、appcast 或其它附件。
- 发布前核实 GitHub Releases 的实际状态；`VERSION` 文件不代表已经发布。
- 不要宣称支持 Sparkle 自动更新：`Info.plist` 里虽然有 `SUFeedURL`/`SUPublicEDKey`，构建也嵌入了 `Sparkle.framework`，但 `main.swift` 只有 `import Sparkle`，**没有启动 updater**，菜单「下载更新…」只是打开 Releases 页面。
- 应用图标以 `desktop/assets/campus-balance-icon.svg` 为源，构建时生成 `.icns`；不要直接改 `.icns`。

### 9.3 发布后自检

```sh
# tag 与本地版本一致
git tag --list "v1.1.4"
cat VERSION

# 下载后校验
hdiutil verify CampusBalance-v1.1.4-macOS-arm64.dmg
spctl -a -vv "校园余额-v1.1.4.app"   # 预期被拒（未公证），属已知
```

---

## 10. 常见坑

1. **脚本要求输出目录不存在**：`build.sh` / `build-with-widget.sh` 在目标已存在时退出；重建先 `rm -rf`。
2. **默认产物在仓库外**：`$ROOT/../校园余额-v$VERSION.app`，别在仓库里找。
3. **只有 arm64**：脚本写死 `-target arm64-apple-macosx13.5`，Intel Mac 不适合作为构建机；发布名也是 `-macOS-arm64.dmg`。
4. **小组件必须完整 Xcode**：只装 Command Line Tools 时 `build-with-widget.sh` 会直接报「需要安装完整版 Xcode」。
5. **ad-hoc 签名 + 钥匙串**：每次重新构建签名会变，可能导致已保存的钥匙串条目需要重新授权/重新登录；测试自动登录时如遇 `KEYCHAIN_FAILED` 先解锁钥匙串或重新登录。
6. **未公证**：他人首次打开需右键「打开」；不要通过去掉 quarantine 之类的方式绕过来「修复」用户环境。
7. **移动/改名 App 后小组件后台任务失效**：LaunchAgent 里记的是旧路径。重新在 App 内登录一次即可重建；或按 §5.4 手工清理。
8. **网页版与 App 的接口要实现两份**：Swift `NativeServer` + Node `api/*.js`；页面共享。
9. **`public/*.html` 会被复制进 .app**：只改仓库文件而不重新构建，App 里看到的还是旧页面。
10. **诊断日志不要加敏感字段**：现有约定只记录固定阶段、错误码、固定接口地址、状态码；不要记录账号、密码、Cookie、完整认证 URL、电表号。
11. **HTTP 回退只对电表域名开启**：`Info.plist` 的 ATS 例外只给 `shsd.buaa.edu.cn`；`SchoolHTTP` 白名单一律 https。
12. **学号/密码格式限制**：账号 `^[A-Za-z0-9][A-Za-z0-9@._-]{1,64}$`，密码非空且 ≤1024 字节（网页版接口另有 ≤256 限制）；改校验时两边同步。
13. **Sparkle 下载缓存**：首次构建需要网络；离线时可预置 `~/Library/Caches/CampusBalance/Sparkle-2.10.1`。
14. **`electron/` 目录是 Windows 版**：它复用 `public/`、`lib/`、`api/`，改动这些共享文件后要同时跑 `npm test`（含 Electron 用例），Windows 与 macOS 都已覆盖。

---

## 11. 常见修改场景 recipe

| 想做什么 | 改哪里 |
| --- | --- |
| 改文案/配色/圆角/间距/动效 | `public/index.html`、`public/dashboard.html`（设计 token 在 `:root`） |
| 改图表逻辑（柱状/折线、提示框、坐标轴） | `public/dashboard.html` 的 `<script>` |
| 改某个余额的抓取方式/解析 | `desktop/native/SchoolClient.swift`、`SchoolHTML.swift`、`Electricity.swift` |
| 新增一个指标 | `NativeDashboard.swift`（`part`/`refresh` 与 JSON 字段）+ `dashboard.html` 的 `groups` + `WidgetSnapshots`/`BalanceMetric`（若要进小组件）+ `api/data.js`/`lib/campus.js`（网页模式） |
| 新增诊断错误码/阶段 | `Diagnostics.swift`（`Code`/`Stage`/`message`/`endpoint`），页面会自动显示 `message` |
| 改接口地址/白名单 | `SchoolHTTP.swift` 的 `SchoolRedirectPolicy.hosts`、`SchoolClient.swift`；同步 `Info.plist` ATS 例外（如需 http） |
| 改登录/自动登录行为 | `NativeServer.swift`（`/api/auth`）、`LocalSettings.swift`（`CampusKeychain`）、`NativeDashboard.swift`（重新登录） |
| 改小组件外观 | `desktop/widget/CampusBalanceWidget.swift` |
| 改后台刷新时间 | `WidgetAgents.swift`（`StartCalendarInterval`，注意 `matches` 也写死了 8:30） |
| 加 JS 测试 | `tests/` 新建 `*.test.js`（`node --test` 自动发现） |
| 加原生测试 | `tests/native/main.swift` 里加 `check(...)` |

---

## 12. 与 Windows 版的关系

- Windows 版使用 **Electron**（`electron/`），直接复用 `public/**` 页面和 `lib/`、`api/` 数据层，因此 macOS 这边改页面/改接口时 Windows 会同步受益（前提是两边都走同一套 `lib/` 行为）。
- 页面里只有一处为 Electron 增加了桥接：`public/index.html` 中若存在 `window.campusBridge.openSchoolLogin`，则「学校统一认证」交给 Electron 主进程处理；`window.__campusNative` 与网页模式分支保持原样。
- 之前基于 C# + WinUI 3 的 `windows/` 实现已按用户要求归档到本地分支 `archive/winui3` 并从工作区移除，不再参与构建。
- 数据层是各自独立实现（Swift / Electron 复用 Node），不过 Electron 版是直接调用现有 Node 数据层，解析逻辑只有 Node 一份。
- 两边共享：`desktop/assets/campus-balance-icon.svg`（图标源，Electron 由 `electron/make-icon.mjs` 生成 ico/托盘图）、设计 token 与页面。

---

## 13. 交接待办 / 已知现状

- Sparkle 自动更新**未启用**（只嵌入了 framework 与 Info.plist 配置）；如果以后恢复自动更新，需要同时产出 appcast 并改发布流程（当前与 `AGENTS.md` 的 DMG-only 要求冲突，需先确认）。
- 代码里仍保留网页模式（Vercel）+ Node 一套 `api/`、`lib/`，与本机 App 并行维护；新增接口容易漏掉一边（§3）。
- 小组件后台任务依赖 `~/Library/LaunchAgents`，没有集中诊断入口；组件问题优先看 `log show --last 10m --predicate 'subsystem == "edu.buaa.campusbalance"'`。
- 未做 Apple Developer ID 签名与公证；如要正式分发，需要先补签名/公证与发布流程。
- 未见本地化基础设施（仅中文硬编码）；如要加语言需引入字符串资源。
