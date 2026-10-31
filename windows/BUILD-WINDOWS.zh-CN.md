# 在另一台 Windows 电脑编译

此源码包是基于 v1.1.4 的 Windows 迁移开发版，不是已发布的 Windows 安装包。

> 本次更新有两部分：
>
> 1. 修复“双击 EXE 无窗口、事件日志 `0xC000027B` / `Microsoft.UI.Xaml.dll`”：`dotnet publish` 会把未打包 WinUI 应用的资源索引 `CampusBalance.pri` 漏在发布目录外（microsoft/WindowsAppSDK#6720），导致应用在 XAML 初始化时崩溃。现在工程会把 PRI 补进发布输出，`build.ps1` 还会从构建输出补齐并校验；应用启动前也会检查该文件，缺失时给出提示而不是直接崩溃。
> 2. 界面按 macOS 端同一份设计重做：配色与圆角卡片、左侧余额栏的滑动选中色块、图表网格/柱状/折线、统计区、登录卡片、电表号对话框，以及选中滑动、柱状逐根入场、折线绘制、悬停提示、对话框上浮等动效；数字使用随包分发的 Space Grotesk 字体。
>
> **必须用这个源码包重新编译，旧的 `artifacts` 目录不能用。**

## 1. 安装环境

使用 Windows 11 电脑。安装 Visual Studio 2026 Community，在安装器中勾选 **WinUI application development / WinUI 应用程序开发** 工作负载，保留它默认选中的组件。

官方安装说明：https://learn.microsoft.com/en-us/windows/apps/get-started/start-here

确认安装了 **.NET 10 SDK**（只有 Runtime 不够）。如果没有，在 PowerShell 中运行：

```powershell
winget install --id Microsoft.DotNet.SDK.10 --exact --source winget
```

安装后重新打开 PowerShell，检查：

```powershell
dotnet --list-sdks
```

输出应包含 `10.0.xxx`。不用安装 Node.js、npm 或 Electron，也不用新建 WinUI 模板项目。

## 2. 解压源码

将提供的本地源码包传到 Windows，解压到例如 `C:\code`，保留整个目录结构。项目根目录应为：

```text
C:\code\campus-balance-windows\
  windows\build.ps1
  windows\CampusBalance.App\CampusBalance.App.csproj
  windows\CampusBalance.Core\CampusBalance.Core.csproj
  windows\CampusBalance.Core.Tests\CampusBalance.Core.Tests.csproj
  desktop\assets\campus-balance-icon.svg
```

SVG 在工程中有相对路径引用，不要只复制 `windows` 文件夹。源码包不含账号配置、.env、node_modules 或 Mac 构建产物。

## 3. 执行编译

在 PowerShell 中进入根目录：

```powershell
cd C:\code\campus-balance-windows
```

普通 Intel / AMD 电脑执行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\windows\build.ps1 2>&1 | Tee-Object -FilePath .\windows-build.log
```

ARM 电脑（如 Snapdragon）改为：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\windows\build.ps1 -Architecture ARM64 2>&1 | Tee-Object -FilePath .\windows-build.log
```

`Bypass` 只作用于本次 PowerShell 进程，不修改系统的永久执行策略。首次编译需要联网下载 NuGet 依赖，不需要登录学校账号。脚本先执行核心测试，再构建完整 WinUI 应用。

## 4. 启动应用

x64 版本：

```powershell
& .\windows\artifacts\win-x64\CampusBalance.exe
```

ARM64 版本：

```powershell
& .\windows\artifacts\win-arm64\CampusBalance.exe
```

也可以在资源管理器中双击 EXE。应用目录包含运行时和资源，移动时保留整个目录，不要只拿走 EXE。

发布目录必须包含 `CampusBalance.exe`、`CampusBalance.pri` 以及 `App.xbf`、`MainWindow.xbf` 等编译后的 XAML。`build.ps1` 结束前会校验这两个条件，缺少 PRI 时会直接从构建输出复制并打印警告。可以在 PowerShell 中确认：

```powershell
Get-ChildItem .\windows\artifacts\win-x64\CampusBalance.pri, .\windows\artifacts\win-x64\*.xbf
```

如果目录里没有 `CampusBalance.pri`（也没有 `resources.pri`），双击 EXE 后进程会立即退出，事件日志里的故障模块是 `Microsoft.UI.Xaml.dll`、异常代码 `0xC000027B`。

打开后依次检查窗口、登录、校园卡、流量、电表设置和图表。界面逐项核对：

- 登录页：窗口中央 440 宽的白色圆角卡片、顶部蓝色圆角图标、胶囊输入框和“登录 →”深色胶囊按钮。
- 仪表盘：左侧浅色余额栏 + 选中项蓝色圆角块（切换类别时色块滑动、文字变白）、右侧标题/统计区与图表。
- 动效：柱状图逐根从底部生长；切到“折线”后折线从左向右绘制、面积淡入；鼠标在图表上移动出现深色数值提示；切换类别时右侧标题上浮；点击“电表号”对话框上浮出现。
- 窄窗口（拖到 ~420 宽）与深色模式也应保持可读，统计区在很窄时变成两列。

登录时需要能访问学校服务的网络；测试流量查询时勾选“校园网使用相同密码”。可选的“打开学校统一认证”功能需要 Microsoft Edge WebView2 Runtime，安装入口：https://developer.microsoft.com/en-us/microsoft-edge/webview2/

## 5. 遇到错误

- 找不到 `dotnet`：安装 SDK 后重新打开终端，执行 `dotnet --list-sdks`。
- 提示不支持目标 .NET 版本：确认安装的是 .NET 10 SDK，而不是只有 Runtime。
- `NU1301` 等还原错误：检查到 `https://api.nuget.org/v3/index.json` 的网络连接。
- 出现 `WMC` / `XAML` / C# 编译错误：保留 `windows-build.log`，提供第一条错误及前后内容，不要仅提供末尾“构建失败”。
- EXE 不能启动、窗口一闪而过或双击无反应：在 Windows 事件查看器的“Windows 日志 → 应用程序”中查看对应的 `.NET Runtime` 或 `Application Error` 记录。
  - 若异常代码为 `0xC000027B`、故障模块为 `Microsoft.UI.Xaml.dll`：基本都是发布目录缺少 WinUI 资源索引。先执行 `dir .\windows\artifacts\win-x64\*.pri` 确认；缺少就用本源码包重新执行 `.\windows\build.ps1`（会自动补齐）。只想快速验证时，可把 `windows\CampusBalance.App\bin\x64\Release\net10.0-windows10.0.19041.0\win-x64\CampusBalance.pri` 手动复制到 `windows\artifacts\win-x64\` 后再次启动。
  - 应用启动前已加入 PRI 检查：目录不完整时会弹窗说明，详情同时写入 `%LOCALAPPDATA%\CampusBalance\Logs\startup.ndjson`。
- 能打开但查询失败：菜单“打开诊断日志”定位 `%LOCALAPPDATA%\CampusBalance\Logs`。

这是首次 Windows 完整构建验证；本机 macOS 已通过核心测试和界面 C# 引用检查，但尚未通过 Windows XAML 编译及实机验收。
