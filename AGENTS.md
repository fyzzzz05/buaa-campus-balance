# 项目约定

## UI 设计

Avoid unnecessary secondary labels and descriptions. Let the layout do the explaining.

- 未经用户明确要求，不更改页面布局或正常状态文案；协议、HTTP 回退、历史兜底等调试信息保留在诊断日志中。

## 发布

- 用户要求：今后发布仅上传 DMG 安装包，不上传 ZIP 等其他发布附件。
- 发布前核实 GitHub Releases 的实际状态；本地 VERSION 不代表已经发布。
- 仅发布 DMG 时不生成 ZIP 或 appcast，按手动下载安装分发；不要宣称此发布可通过 Sparkle 自动更新。

## 应用图标

- 后续发布使用用户提供的 `desktop/assets/campus-balance-icon.svg` 作为应用图标源文件，保留原始 SVG。
- 打包时从此源文件生成 macOS `.icns`，接入应用资源及 `CFBundleIconFile`，发布前验证实际图标。
