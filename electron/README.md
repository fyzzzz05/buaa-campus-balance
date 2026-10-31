# Windows 版（Electron）

Windows 版复用 macOS 端的页面（`public/`）与 Node 数据层（`lib/`、`api/`），外壳是 Electron。实现依据见交接时的任务书；本文件说明日常开发与验收。

## 架构

```
electron/main.js        主进程：本地服务、主窗口、SSO 窗口、托盘与弹窗、每日刷新
electron/server.js      用进程内随机 secret 配置 lib/runtime，再启动共享本地服务
electron/preload.js     向页面暴露 campusBridge，向托盘弹窗暴露 campusPanel
electron/credentials.js safeStorage 凭据适配器（密码加密、账号提示、按账号隔离）
electron/scheduler.js   每天 08:30 + 睡眠唤醒补刷（纯函数 + 薄封装，便于测试）
electron/paths.js       userData/logs 路径、托盘弹窗口位置计算
electron/navigation.js  学校域名 / 本机地址 / 外链白名单（纯函数）
electron/widget-store.js 快照文件存写 + 后台刷新账号状态（替代 macOS LaunchAgent）
electron/tray-panel.html 托盘弹窗（360 宽，点托盘图标开关，行内展开 14 天走势）
electron/make-icon.mjs  从 desktop/assets/campus-balance-icon.svg 生成 build/icon.ico 与托盘图标
electron/build.mjs      注入 VERSION 后调用 electron-builder（NSIS x64）
```

页面走「网页模式」通路：不注入 `window.__campusNative`，登录后由 `/api/data` 一次取全量。
`public/index.html` 只增加了一处桥接：存在 `window.campusBridge.openSchoolLogin` 时，
「学校统一认证」按钮交给主进程打开认证窗口；macOS App 与网页模式的分支保持原样。

## 开发

```sh
npm ci
npm run electron:icons   # 首次或图标源 SVG 变更后生成 build/icon.ico
npm run electron:dev     # 在 macOS 上也能直接跑（safeStorage 走钥匙串）
npm test                 # 共享逻辑 + tests/electron 下的适配器/调度/安全测试
```

- 需要 Node 22+；打包 Windows 安装包需要 Windows 或 CI（`npm run electron:build:win`）。
- 本地服务只监听 `127.0.0.1` 随机端口，密钥与 native token 仅在进程内存在。
- 状态目录：`app.getPath('userData')`（凭据、设置、快照、小窗位置、刷新状态）；
  日志：`app.getPath('logs')/diagnostics.ndjson`（256 KiB 轮转，保留 `.1`）。

## 打包

```sh
npm run electron:build:win
# 产物：dist-electron/CampusBalance-v<VERSION>-Windows-x64-setup.exe
```

版本号唯一来源是仓库根目录 `VERSION`；`electron/build.mjs` 把它写入 `extraMetadata.version`。
图标由 `make-icon.mjs` 生成到 `build/`（已 gitignore），构建时自动执行。

安装包未签名，首次运行会出现 SmartScreen 警告；未启用自动更新。

实测包体：安装包约 109 MB，解压后约 322 MB（Electron 运行时 + Chromium 占主要部分）。
只保留 `zh-CN`、`en-US` 语言包，并排除 `tests/`、`desktop/`、`windows/`、`docs/`。

## 安全约束（勿放宽）

- 所有窗口：`contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`、`webviewTag: false`。
- 主窗口只能停在 `http://127.0.0.1:<port>`；外链仅 https 交给系统浏览器。
- 学校认证窗口只允许 `cc-pay / pass / mall / sso` 的 https 页面；其它链接交给系统浏览器。
- 本地服务校验 `Host`、POST 的 `Origin`、请求头/请求体大小，并为页面加 CSP。
- 学校请求统一走 `lib/campus.js` 的域名白名单；电表 HTTP 回退只对 `shsd.buaa.edu.cn`。
- 日志不得包含账号、密码、Cookie、完整认证 URL、电表号。

## Windows 真机验收清单

1. 安装（SmartScreen 警告属已知）、启动登录页。
2. 密码登录后四项余额显示；密码错误有提示。
3. 学校统一认证成功，且未启用自动登录。
4. 设置电表号 → 刷新 → 重启后仍在。
5. 勾选「保存密码，自动重新登录」→ 重启自动登录；取消后密码被清除。
6. 关闭窗口进托盘；托盘菜单各项可用；重复启动只唤起已有窗口。
7. 托盘弹窗：单击托盘图标在图标旁弹出/收起，点空白处或 Esc 关闭；四项余额正确，点行展开/收起 14 天走势，↑↓ 切换；
   刷新按钮转圈并更新「更新于」；「打开完整窗口」定位到当前项；「电表号设置」弹出电表号对话框；拖到屏幕边缘或侧边任务栏后弹窗不越界。
8. 开机自启：重启后只进托盘（`--hidden`）。
9. 睡眠唤醒后补刷数据。
10. 断网不崩溃，显示「更新失败」并保留旧值。
11. 浅色/深色、150% 缩放、中文字体正常。
12. 卸载后应用目录清理；`userData` 无明文密码。
