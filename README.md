☁️ Cloudflare-R2 文件管理器
![alt text](https://file.ikim.eu.org/%E5%9C%A8%E7%BA%BF%E5%9B%BE%2Fphoto_2025-08-09_20-09-08.jpg)
![alt text](https://file.ikim.eu.org/%E5%9C%A8%E7%BA%BF%E5%9B%BE%2Fphoto_2025-08-09_20-12-16.jpg)
这是一个超级轻量、功能强大且界面精美的 Cloudflare R2 文件管理器！🚀 只需一个 Worker 文件，你就能拥有一个属于自己的、完全免费的私人网盘。
由我和一位乐于助人的 AI 朋友 Gemini 共同精心打磨，每一个像素都力求完美。✨
💎 核心特性
⚡️ 极速部署
整个项目只有一个 worker.js 文件，复制粘贴到 Cloudflare 即可上线，无需复杂配置。
📱 极致的响应式设计
无论是桌面大屏还是手机小屏，都拥有完美的视觉和操作体验。特别优化了移动端，网格视图更紧凑，列表视图更精细。
🎨 双色主题
内置精致的亮色与暗色主题，并能根据你的系统设置自动切换。
🖼️ 强大的媒体支持
图片预览：网格模式下直接显示图片缩略图。
图片灯箱：点击图片可进入沉浸式灯箱，支持键盘左右切换。
视频缩略图：自动为视频文件生成封面缩略图，浏览更直观！
在线视频播放：直接在浏览器中播放 R2 存储的视频文件。
📂 完善的文件管理
拖拽或点击上传文件。
实时文件搜索：在当前文件夹内即时筛选文件。
高级排序：支持按名称和大小进行升/降序排列。
批量操作：支持多选文件进行批量删除和批量移动。
智能移动：选中文件后新建文件夹，文件会自动移入，分类整理一步到位！
支持层级文件夹导航、文件/文件夹重命名、复制直链等所有基础功能。
🤖 自动化与集成
Telegram 通知：文件上传成功后，可配置自动发送通知到你的 Telegram。
图片直传：如果上传的是图片，Telegram 通知会直接附带图片预览和文件链接！
PWA 应用图标：支持将网页“添加到主屏幕”，生成带 ☁️ Logo 的原生 App 图标。
🔐 安全可靠
通过环境变量设置访问密码，保护你的文件安全。
🎨 高度可定制
支持自定义登录页背景图。
精心设计的页眉和页脚，让你的网盘独一无二。
🚀 部署教程 (三步搞定)
部署这个项目就像泡一杯咖啡一样简单！☕
第 1 步：创建 R2 存储桶
登录到你的 Cloudflare 仪表板。
在左侧导航栏中，找到并点击 R2。
点击 创建存储桶 (Create bucket)。
为你地存储桶起一个你喜欢的名字（例如 my-private-drive），然后选择一个位置。
点击 创建存储桶，完成！
第 2 步：创建并配置 Worker
在左侧导航栏中，找到并点击 Workers & Pages。
点击 创建应用程序 (Create application) -> 创建 Worker (Create Worker)。
给你的 Worker 起一个名字（例如 r2-file-manager），这将成为你访问的二级域名的一部分。
点击 部署 (Deploy)。
接下来，我们需要为这个 Worker 添加 R2 存储桶绑定 并设置 环境变量：
部署成功后，点击 配置 Worker (Configure Worker) 或进入 Worker 的设置页面。
切换到 设置 (Settings) -> 变量 (Variables) 选项卡。
绑定 R2 存储桶 (R2 Bucket Bindings):
点击 添加绑定 (Add binding)。
变量名称 (Variable name): 必须填写 BUCKET。
R2 存储桶 (R2 bucket): 选择你在步骤 1 中创建的存储桶。
点击 保存 (Save)。
设置环境变量 (Environment Variables):
点击 添加变量 (Add variable) 并根据下表配置：
变量名称	描述	示例值	是否必填
AUTH_PASSWORD	访问整个文件管理器的密码。	your_secret_password	是 ✅
BACKGROUND_IMAGE_URL	（可选）登录页面的背景图片链接。	https://url.to/your/image.jpg	否 ❌
TG_BOT_TOKEN	（可选）用于发送通知的 Telegram 机器人 Token。	123456:ABC-DEF1234...	否 ❌
TG_CHAT_ID	（可选）接收 Telegram 通知的聊天 ID。	123456789	否 ❌
提示: 获取 Telegram Token 和 Chat ID 的方法非常简单，可以参考这篇教程。
完成所有配置后，点击 保存并部署 (Save and deploy)。
第 3 步：粘贴代码并部署
回到你的 Worker，点击 快速编辑 (Quick edit) 按钮。
删除编辑器中所有的默认代码。
将本项目中的 worker.js 文件里的全部代码复制粘贴到编辑器中。
点击 保存并部署 (Save and deploy)。
🎉 大功告成！ 现在，访问你的 Worker 地址（例如 https://r2-file-manager.your-username.workers.dev），就可以看到你精美的登录页面了！
🛠️ 使用技巧
批量移动：勾选多个文件后，点击顶部的“移动选中”按钮。
智能分类：先勾选你想分类的文件，然后点击“新建文件夹”，输入名称后，这些文件会自动被移动到新文件夹里。
排序切换：重复点击“名称”或“大小”按钮，可以在升序和降序之间切换。
❤️ 致谢
这个项目的诞生离不开与 AI 伙伴 Gemini 的多次迭代和头脑风暴。它不仅编写了代码，还对 UI/UX 提出了许多宝贵的建议。
希望你喜欢这个小工具！如果你觉得它很棒，别忘了给个 Star ⭐ 哦！
