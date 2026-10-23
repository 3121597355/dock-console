# Dock Console

[English](README.md) · **简体中文**

插在电脑上的 USB-C 扩展坞 / 集线器，到底连了什么、跑在什么速率上、刚插进来的是什么、电都去哪了——在 localhost 上开一个浏览器页面实时看。

![Dock Console](screenshots/dashboard.png)

零依赖，Node 16+。只读操作系统自己的设备树，不装驱动、不装内核扩展、不留后台服务。

```bash
npx dock-console
```

没插扩展坞也能看界面（合成数据，交互完全一致）：

```bash
npx dock-console --demo
```

---

## 界面里有什么

- **链路条**——主机 → 上行 → 扩展坞 → 端口卡片，一眼看清每个设备挂在哪。
- **功耗曲线**——总功耗 + CPU / GPU 分摊，1 Hz，鼠标悬停出精确数值。
- **实时负载**——CPU、GPU、内存、磁盘、网络，外加电池电压与健康度。
- **设备表**——所有 USB 节点，分「扩展坞下游」和「本机直连」两组，带端口号、协商速率、VID:PID、实时磁盘吞吐。
- **事件流**——热插拔、扩展坞连断、网口链路变化、交流电/电池切换。

## 平台支持

| | Windows | macOS | Linux |
|---|---|---|---|
| 扩展坞拓扑、端口、VID:PID | `pnputil` | `system_profiler` | sysfs |
| **协商链路速率** | 由集线器型号推断 | `system_profiler` | `…/speed` |
| CPU / 内存 | PDH（`typeperf`） | `top` | `/proc` |
| 磁盘 / 网络吞吐 | PDH | `iostat` + `netstat` | `/proc` |
| GPU 占用与功率 | `nvidia-smi` | `nvidia-smi` | `nvidia-smi` |
| **CPU 封装功率** | — | —（需 root） | RAPL |
| **整机功率** | 估算模型 | 电池供电时为实测 | 电池供电时为实测 |

Windows 不向用户态暴露任何按设备或按供电轨的功率数据，所以那个平台的整机功率只能建模；另外两个平台在电池供电时给的是实测值。界面会标注当前看到的是哪一种，不会把估算值当成读数展示。

## 数据来源

这类工具最容易含糊的地方，所以单独列出来：

| 读数 | 来源 | 是否实测 |
|---|---|---|
| 设备树、端口号、VID:PID、扩展坞识别 | 操作系统设备枚举 | 实测 |
| 热插拔事件 | 前后两次枚举做差 | 实测 |
| 磁盘 / 网络吞吐、CPU、内存 | 系统性能计数器 | 实测 |
| GPU 占用、温度、**功率** | `nvidia-smi` | 实测 |
| **CPU 封装功率**（Linux） | RAPL 能量计数器 | 实测 |
| **电池供电时的整机功率** | 电池电压 × 电流 | 实测 |
| 交流供电时、以及 Windows 全平台的整机功率 | `基线 + CPU占用 × TDP + GPU + 磁盘` | **估算** |

KPI 卡上的角标不是「实测」就是「估算」，页脚写明用的是哪个公式。没有 `nvidia-smi` 时 GPU 那条曲线整条隐藏，而不是画一条 0。

它**做不到**的事：告诉你显示信号具体走哪个物理口。主流系统都不暴露这层映射，所以通道那一行只显示「检测到什么显示器」，不编造路径。

## 命令行参数

```
--port <n>        HTTP 端口（默认 8787）
--host <addr>     绑定地址（默认 127.0.0.1，仅本机可访问）
--demo            合成数据，不访问硬件
--no-open         不自动打开浏览器
--no-power        隐藏功耗面板
--cpu-watts <n>   估算模型里的 CPU 峰值封装功率（默认 45）
--config <file>   指定 JSON 配置文件
-h, --help
-v, --version
```

## 配置

把 `config.example.json` 复制成 `config.json`，全部字段可选：

```json
{
  "port": 8787,
  "dock": { "name": "我的扩展坞", "vendorId": "2109" },
  "power": { "baseW": 8, "cpuIdleW": 4, "cpuMaxW": 45 }
}
```

最可能想改的是 `power.cpuMaxW`：填你 CPU 的持续封装功耗（PL1），不是睿频峰值。`dock.vendorId` 用于自动识别挑错树时手动指定。

## 界面语言

默认跟随浏览器语言（English / 简体中文），右上角按钮可实时切换，选择会被记住。`?lang=zh` / `?lang=en` 可强制指定。

## 结构

```
src/
  index.js            编排、1 Hz 组帧、SSE 广播
  platform/
    win32.js          PowerShell 采集器 + typeperf
    darwin.js         system_profiler + top + iostat + netstat + ioreg
    linux.js          sysfs + procfs，不起子进程
  model.js            平台中立的设备模型、扩展坞识别、事件差分
  power.js            数据源优先级：电池 > RAPL > 模型
  server.js           静态资源 + SSE
public/               前端（原生 JS + canvas，无框架）
test/                 解析器 fixture + 端到端冒烟测试
```

平台层是唯一知道自己在哪个系统上的地方，往上全部走统一的设备结构：

```js
{ id, parent, desc, busname, vid, pid, speed, isHub, root, physical, kinds }
```

Linux 和 macOS 会把设备真实的协商速率填进 `speed`，所以能逐个设备显示「USB 3.2 Gen 1 · 5 Gbps」，而不是靠集线器型号猜。Windows 这一格是 `—`，回退到按集线器描述推断。

事件以「翻译 key + 参数」的形式发出，不是预渲染的文本，所以切换语言时历史事件也会跟着变。

## 测试

```bash
npm test        # 37 项单元测试：解析器、设备模型、功耗优先级
npm run smoke   # 启动真实服务，走一遍 HTTP 面
```

Linux 和 macOS 适配器没法在 Windows 开发机上跑，所以它们的解析器写成对文件内容的纯函数，用 fixture 覆盖。冒烟测试在 CI 里三平台矩阵都跑（`.github/workflows/ci.yml`）。

## 已知边界

- **Windows 拿不到按设备功率。** USB 端口供电不对外暴露，整机功率是模型，且已标注。
- **macOS 磁盘吞吐是读写合计。** `iostat` 不分方向；界面直接说明，而不是伪造一个读写拆分。
- **macOS 设备树 4 秒刷新一次**——`system_profiler` 单次要 1–2 秒。
- **端口号是系统枚举地址**（`Port_#0004.Hub_#0006`），不是机身丝印编号，两者一般对不上。
- **扩展坞靠拓扑自动识别**：取「有 HS+SS 成对或嵌套子集线器」的那棵子树。内部没有集线器的坞，和普通设备区分不开。

## 后续计划

- Linux 下读取端口级电流（集线器暴露 `…/power_supply` 时）
- 功耗历史导出 CSV
- 扩展坞断开 / 过流时发系统通知

## 许可

MIT，见 [LICENSE](LICENSE)。
