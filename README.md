# LeeNote

LeeNote 是一款本地优先的跨平台 Markdown 桌面便签，支持普通、置顶和桌面底层三种窗口模式。

## 当前功能

- 多便签创建、编辑、收藏、归档和搜索
- Markdown 编辑、分栏和预览
- 本地自动保存
- 六种便签颜色与系统深色模式
- 普通、始终置顶、始终置底窗口层级
- 系统托盘显示、新建便签和退出
- macOS 风格无边框窗口

## 开发

需要 Node.js、Rust 和对应平台的 Tauri 系统依赖。

```bash
npm install
npm run tauri dev
```

仅运行前端界面：

```bash
npm run dev
```

## 打包说明

LeeNote 使用 Tauri 2 打包。macOS 安装包需要在 macOS 上生成，Windows MSI 安装包需要在 Windows 上生成。正式发布前，请同步修改 `package.json` 和 `src-tauri/tauri.conf.json` 中的 `version`。

首次拉取项目或依赖发生变化后，在项目根目录安装锁定版本的依赖：

```shell
npm ci
```

`src-tauri/tauri.conf.json` 当前配置了 `"targets": "all"`。直接运行 `npm run tauri build` 会构建当前操作系统支持的全部安装包；下面的命令通过 `--bundles` 明确指定产物类型，便于发布。

### macOS 打包

#### 1. 准备环境

支持 macOS Catalina 10.15 及以上版本。安装 Xcode Command Line Tools：

```shell
xcode-select --install
```

从 [Node.js 官网](https://nodejs.org/) 安装 LTS 版本，然后安装 Rust：

```shell
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"
```

确认工具可用并安装项目依赖：

```shell
node --version
npm --version
rustc --version
cargo --version
npm ci
```

#### 2. 构建当前 Mac 架构

下面的命令会生成可直接运行的 `.app` 和用于分发的 `.dmg`：

```shell
npm run tauri build -- --bundles app,dmg
```

产物目录：

```text
src-tauri/target/release/bundle/macos/    # LeeNote.app
src-tauri/target/release/bundle/dmg/      # LeeNote_*.dmg
```

Apple Silicon Mac 默认生成 `aarch64` 版本，Intel Mac 默认生成 `x86_64` 版本。

#### 3. 构建 Universal 通用版本

Universal 应用同时支持 Apple Silicon 和 Intel Mac：

```shell
rustup target add aarch64-apple-darwin x86_64-apple-darwin
npm run tauri build -- --target universal-apple-darwin --bundles app,dmg
```

产物目录：

```text
src-tauri/target/universal-apple-darwin/release/bundle/macos/
src-tauri/target/universal-apple-darwin/release/bundle/dmg/
```

也可以单独构建指定架构：

```shell
# Apple Silicon
rustup target add aarch64-apple-darwin
npm run tauri build -- --target aarch64-apple-darwin --bundles app,dmg

# Intel
rustup target add x86_64-apple-darwin
npm run tauri build -- --target x86_64-apple-darwin --bundles app,dmg
```

#### 4. 签名与公证

本地调试可以直接使用未签名产物。向其他用户分发时，Apple Gatekeeper 要求使用 Apple Developer ID 签名并完成公证。证书、环境变量和公证流程参考 [Tauri macOS 签名文档](https://v2.tauri.app/distribute/sign/macos/)。完成配置后继续使用同一条 `npm run tauri build` 命令，Tauri 会在打包阶段执行签名和公证。

### Windows 打包

以下命令使用 PowerShell 7 执行。

#### 1. 准备环境

安装 PowerShell 7、Node.js LTS、Rust、Microsoft C++ Build Tools 和 WebView2 Runtime：

```powershell
winget install --id Microsoft.PowerShell --exact
winget install --id OpenJS.NodeJS.LTS --exact
winget install --id Rustlang.Rustup --exact
winget install --id Microsoft.VisualStudio.2022.BuildTools --exact --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
winget install --id Microsoft.EdgeWebView2Runtime --exact
```

安装完成后重新打开 PowerShell 7，选择 MSVC Rust 工具链并安装项目依赖：

```powershell
rustup default stable-msvc
node --version
npm --version
rustc --version
cargo --version
npm ci
```

Windows 10 1803 及以上版本通常已包含 WebView2 Runtime，重复执行安装命令会由 `winget` 提示当前安装状态。

#### 2. 生成 EXE 和 MSI 安装包

```powershell
npm run tauri build -- --bundles nsis,msi
```

产物目录：

```text
src-tauri\target\release\bundle\nsis\    # LeeNote_*-setup.exe
src-tauri\target\release\bundle\msi\     # LeeNote_*.msi
```

只生成一种安装包时使用：

```powershell
# NSIS EXE 安装包
npm run tauri build -- --bundles nsis

# MSI 安装包
npm run tauri build -- --bundles msi
```

构建 MSI 需要启用 Windows 的 `VBSCRIPT` 可选功能。出现 `failed to run light.exe` 时，进入“设置 → 应用 → 可选功能 → 更多 Windows 功能”，启用 `VBSCRIPT` 后重启系统。只发布 NSIS EXE 时可直接使用 `--bundles nsis`。

#### 3. 构建指定架构

常规 x64 Windows 机器直接使用上一节命令即可。构建 ARM64 版本时，还需要在 Visual Studio Installer 中为“使用 C++ 的桌面开发”添加 ARM64 编译工具，然后执行：

```powershell
rustup target add aarch64-pc-windows-msvc
npm run tauri build -- --target aarch64-pc-windows-msvc --bundles nsis,msi
```

ARM64 产物位于：

```text
src-tauri\target\aarch64-pc-windows-msvc\release\bundle\
```

#### 4. 代码签名

面向用户发布时，建议使用受信任的代码签名证书对 EXE/MSI 签名，以降低 Microsoft Defender SmartScreen 的未知发布者提示。证书配置与 CI 签名方式参考 [Tauri Windows 签名文档](https://v2.tauri.app/distribute/sign/windows/)。

### 清理后重新打包

需要移除 Rust 历史构建产物时，在项目根目录执行：

macOS：

```shell
cd src-tauri
cargo clean
cd ..
```

Windows PowerShell 7：

```powershell
Set-Location src-tauri
cargo clean
Set-Location ..
```

清理会删除 `src-tauri/target` 中的全部编译缓存和已有安装包，下一次构建会重新编译 Rust 依赖。
