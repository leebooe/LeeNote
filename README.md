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

## 构建

```bash
npm run tauri build
```

macOS Universal 构建：

```bash
rustup target add aarch64-apple-darwin x86_64-apple-darwin
npm run tauri build -- --target universal-apple-darwin
```
