# Android DoH 与验证页实验记录

2026-11-22，阅坛在未发布版本中试验了应用内 DoH、ECH 和独立验证内核。最终保留系统网络、HTTP / SOCKS5 应用代理和系统 WebView。以下记录用于解释这次取舍。

## 真机上看到了什么

| 现象 | 如何判断 |
| --- | --- |
| Android 16 一加真机在「CFluxDo · 仅 DoH」下用系统 WebView 打开验证入口，显示「网页连接已关闭」。同一分钟，实验用 GeckoView 打开了 LINUX DO CDK 登录页。 | 原生主站请求与 WebView 分别建立 TLS 连接。系统 WebView 138 没有向阅坛提供传入本次 ECH 配置的接口。两套内核的对照确认了路径差异，尚未单独证明连接关闭由 ECH 引起。 |
| 验证站能显示登录页，回到阅坛后主站显示「已验证」。 | 网页加载、网站要求人工验证、主站重新可读、账号已登录是四种结果。要确认恢复，须重试原请求。现场没有已登录的 LINUX DO 账号可验证旧会话。 |
| GeckoView 的首次加载曾停在空白页。 | 原生视图曾获得零尺寸，启动时还会出现 `about:blank`。应核对实际视口和最终网页，单看加载回调容易误判。 |
| 加入 GeckoView 的同类 ARM64 测试包从约 58.1 MiB 增至 146.2 MiB。移除整套实验依赖后，同架构包为 55.7 MiB。 | 独立内核随包更新，并有自己的站点会话。系统 WebView 中现有的登录态无法据此推断到新内核。 |
| NodeSeek 的资料接口偶尔超时，同一账号仍可从站点首页读取资料。 | 可用原站首页回退，但要核对当前用户 ID。签到榜、账户流水和资料应分别记录结果，一个接口慢时应能显示已取得的资料。 |

## 区分解析、出口和网页响应

DoH 用 HTTPS 传输 DNS 查询。ECH 保护 TLS 握手中包含站点名称的字段。普通 HTTPS 在没有协商 ECH 时仍可加密网页内容。Android 的支持程度还取决于发起握手的网络库。[RFC 8484](https://www.rfc-editor.org/rfc/rfc8484.html) · [Android ECH 文档](https://developer.android.com/privacy-and-security/encrypted-client-hello)

VPN 开启时，阅坛的流量是否经过 VPN 取决于系统给应用和目的地址分配的路由。仅观察解析结果或「VPN」图标无法确认某个请求的公网出口。测试须经阅坛实际使用的网络通道。各站分别报告 HTTP 响应、验证页和连接故障，才能解释同一网络下只有一个站点打不开的情况。[Android VPN 文档](https://developer.android.com/develop/connectivity/vpn)
