param(
    [ValidateSet('x64', 'ARM64')][string]$Architecture = 'x64',
    [ValidateSet('Debug', 'Release')][string]$Configuration = 'Release'
)
$ErrorActionPreference = 'Stop'
if (-not $IsWindows -and $env:OS -ne 'Windows_NT') { throw 'WinUI 构建需要 Windows。核心测试可在 macOS/Linux 上运行。' }
$rid = if ($Architecture -eq 'ARM64') { 'win-arm64' } else { 'win-x64' }
$project = Join-Path $PSScriptRoot 'CampusBalance.App/CampusBalance.App.csproj'
$output = Join-Path $PSScriptRoot "artifacts/$rid"
$binRoot = Join-Path $PSScriptRoot "CampusBalance.App/bin/$Architecture/$Configuration"
dotnet run --project (Join-Path $PSScriptRoot 'CampusBalance.Core.Tests') --configuration $Configuration
if ($LASTEXITCODE -ne 0) { throw '核心测试失败' }
dotnet publish $project -c $Configuration -p:Platform=$Architecture -r $rid --self-contained true -o $output
if ($LASTEXITCODE -ne 0) { throw 'Windows 应用构建失败' }
if (-not (Test-Path (Join-Path $output 'CampusBalance.exe'))) { throw '未生成应用程序' }
# WinUI 3 未打包应用存在已知问题：dotnet publish 不会把应用自己的 PRI 资源索引带进发布目录
# （microsoft/WindowsAppSDK#6720）。缺少 CampusBalance.pri 时 exe 启动即以 0xC000027B 崩溃。
# csproj 已尝试把 PRI 补进发布列表，这里再从构建输出补齐并校验，避免产出不可启动的目录。
$appPri = 'CampusBalance.pri'
if (-not (Test-Path (Join-Path $output $appPri))) {
    $builtPri = Get-ChildItem -Path $binRoot -Recurse -Filter $appPri -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($builtPri) {
        Copy-Item $builtPri.FullName (Join-Path $output $appPri) -Force
        Write-Warning "dotnet publish 漏掉了 $appPri，已从构建输出复制到发布目录：$($builtPri.FullName)"
    }
}
if (-not (Test-Path (Join-Path $output $appPri)) -and -not (Test-Path (Join-Path $output 'resources.pri'))) {
    throw "发布目录缺少 WinUI 资源索引（$appPri），这样的目录启动会以 0xC000027B 崩溃。请保留 windows-build.log：构建阶段应生成 $binRoot 下的 $appPri。"
}
if (-not (Get-ChildItem -Path $output -Filter '*.xbf' -ErrorAction SilentlyContinue)) {
    Write-Warning '发布目录没有 .xbf（编译后的 XAML），启动可能失败。请保留 windows-build.log。'
}
Write-Host "已构建：$output/CampusBalance.exe"
