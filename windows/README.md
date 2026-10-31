# Windows 原生版

迁移基线：已发布的 `v1.1.4`，提交 `56ddcdf66b95c04e3b27ffe83358ad19fd18a3fd`。

使用 C# / .NET 10 和 WinUI 3。面板、设置和图表使用原生 XAML；应用进程直接请求学校接口，不需要 Node.js、Electron 或本地 HTTP 服务。WebView2 仅用于可选的学校网页登录，使用 InPrivate 配置，不承载面板。

## 构建与运行

需要 Windows 10 2004（19041）或更新版本、.NET 10 SDK，以及 WinUI 开发工具。建议使用带 WinUI 开发工作负载的 Visual Studio。学校网页登录需要 Microsoft Edge WebView2 Runtime；账号密码登录不需要创建 WebView。

在 PowerShell 中执行：

```powershell
./windows/build.ps1
# Windows on Arm
./windows/build.ps1 -Architecture ARM64
```

构建结果位于 `windows/artifacts/win-x64/` 或 `windows/artifacts/win-arm64/`，运行其中的 `CampusBalance.exe`。这是包含 .NET 和 Windows App SDK 运行时的应用目录，复制时必须保留整个目录。当前没有安装器、代码签名或自动更新发布。

`windows-build.yml` 在 PR 或手动触发时检查核心测试及两种架构的 WinUI 构建，不发布 Release 附件。现有 macOS 的 DMG 发布流程保留。

## 已迁移

- 账号密码登录、校园网同密码登录、学校网页认证及 Cookie 导入。
- 校园卡余额、14 天消费流水、余额变化估算兜底；充值不计入消费。
- 免费与计费流量余额、本期用量、按学校结算日汇总的 14 天流水。
- 照明与空调电费、电表身份和类型校验、字段别名、可选 GitHub 历史。
- v1.1.4 的 `byte/B/BYTES` 单位处理及简洁的“截至 yyyy-MM-dd”日期。
- 仅在 HTTPS 连接失败或超时时尝试 HTTP；证书失败不降级。协议和兜底信息只记入诊断日志。
- 按账号隔离的电表设置、DPAPI CurrentUser 加密的自动登录密码、退出登录时删除凭据。
- 界面按 macOS 端的同一份设计重做：设计 token（`#ECEFF4`/`#0F141C` 等）与圆角卡片、左侧余额栏与滑动选中色块、图表网格/柱状/折线、统计区、登录卡片、电表号对话框均与 `public/index.html`、`public/dashboard.html` 对齐。
- 动效与 Web 端一致：选中色块的滑动与文字变色、柱状图逐根入场、折线绘制与面积渐入、标题切换上浮、柱状/折线切换滑块、悬停提示、对话框上浮；跟随系统“减少动画”设置（`UISettings.AnimationsEnabled`）。
- 数字使用随包分发的 Space Grotesk（SIL OFL 1.1，`Assets/Fonts/`，许可全文 `OFL.txt`）；正文使用系统中文字体。
- 系统浅深色主题、图表柱状/折线切换、键盘焦点及读屏标签、PerMonitorV2 高 DPI。
- `Ctrl+R` / `F5` 刷新、`Ctrl+W` 关闭；左侧列表支持方向键选择。在窗口重新激活且距上次查询超过 15 分钟时刷新。

## 数据与诊断

设置、余额估算及加密凭据位于 `%LOCALAPPDATA%\CampusBalance`。学校 Cookie 只在本次会话内存中保留。学校网页认证的网络会话使用 WebView2 InPrivate；网页登录不获取密码，因此不启用校园网同密码登录或持久化自动登录。

菜单“打开诊断日志”定位 `%LOCALAPPDATA%\CampusBalance\Logs`。日志只记录固定阶段、错误码、固定接口地址及状态码，不记录账号、密码、Cookie、完整认证 URL 或电表号。达到 256 KiB 后轮换，保留一份备份。

启动时的 XAML 和窗口构造错误记录到同目录的 `startup.ndjson`，包含异常类型、HRESULT、堆栈及登录前的构造错误信息；后续未处理异常不记录消息内容。

未打包的 WinUI 3 应用需要 exe 同目录下的资源索引 `CampusBalance.pri`（以及 `App.xbf`、`MainWindow.xbf` 等编译后的 XAML）。`dotnet publish` 会把应用自己的 PRI 漏在发布目录之外（microsoft/WindowsAppSDK#6720），此时进程在 XAML 初始化时直接以 `0xC000027B` 退出，事件日志只显示 `Microsoft.UI.Xaml.dll`。工程通过 `AddAppPriToResolvedFileToPublish` 目标把 PRI 补进发布列表，`build.ps1` 再从构建输出补齐并校验 PRI 与 XBF；应用启动前也会检查该文件，缺失时弹窗说明并写入 `startup.ndjson`，而不是直接崩溃。

## 验证

纯 C# 核心检查可在 macOS、Linux、Windows 上运行，无需学校账号：

```sh
dotnet run --project windows/CampusBalance.Core.Tests --configuration Release
```

测试使用合成响应，覆盖登录编码、跳转边界、响应大小、电表匹配、流量单位、完整分页、历史估算、账号隔离和日志脱敏。DPAPI 运行时检查只在 Windows 执行。

当前 macOS 环境不能执行 WinUI XAML 编译器或运行 Windows 窗口。Windows 构建、窗口视觉效果、高 DPI、多屏幕、真实学校认证（含验证码）及睡眠唤醒需要 Windows 实机验收。新增工作流提供构建入口，不代表已经在远端执行成功。

## 后续适配

尚未移植 macOS WidgetKit 小组件、每天 8:30 的独立后台刷新、托盘、通知和开机启动。关闭窗口即退出；不会创建后台任务。Windows 组件需要另外设计，不能直接复用 macOS 组件。

应用 ICO 从原始 `desktop/assets/campus-balance-icon.svg` 派生，保留原始 SVG，并在构建中复制给登录页使用。修改 SVG 后需要同步重新生成多分辨率 ICO。

在 macOS 上从仓库根目录重新生成图标：

```sh
swift desktop/make-icon.swift desktop/assets/campus-balance-icon.svg /tmp/campus-windows.iconset
python3 windows/tools/make-ico.py /tmp/campus-windows.iconset windows/CampusBalance.App/Assets/AppIcon.ico
```

参考：[WinUI 3 开发](https://learn.microsoft.com/en-us/windows/apps/get-started)、[独立部署](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/self-contained-deploy/deploy-self-contained-apps)、[WebView2 WinUI](https://learn.microsoft.com/en-us/microsoft-edge/webview2/platforms/winui3-windows-app-sdk)、[DPAPI](https://learn.microsoft.com/en-us/dotnet/standard/security/how-to-use-data-protection)。
