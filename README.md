# 手机标签浏览器 OCR

在线使用：https://harry6937.github.io/phone-label-ocr/

多图导入，提取型号、内存/存储、IMEI 1、IMEI 2；大图对照编辑，保存并下一张跳过成功及已核对记录，导出 Excel。

OCR 在当前设备的浏览器中运行。GitHub Pages 只提供网页及模型；图片不上传，记录保存在当前浏览器的 IndexedDB。清除网站数据会删除记录，请及时导出。各设备的数据独立。

首次识别需要下载模型，请保持页面打开。优先使用 JPG / PNG / WebP。模糊、小字及倾斜照片可能漏读或误读，必须对照原图核对，IMEI 校验不能保证识别正确。手机和不同浏览器的兼容性与速度以实测为准。

本仓库是可直接部署的静态发布文件，所有运行资源都在根目录，不依赖外部 CDN 或 Mac 识别服务。GitHub Pages 使用 main 分支根目录。

第三方组件：Tesseract.js 6.0.1、Tesseract.js-core 6.0.0，以及 @tesseract.js-data/eng 和 chi_sim 1.0.0 的 4.0.0_best_int 模型。许可证文件和 SHA256SUMS.json 随包提供。
