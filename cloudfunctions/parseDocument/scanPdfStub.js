// ===================== 扫描版PDF处理提示 =====================
// 注意：微信云函数默认环境无 ImageMagick/pdftoppm，且内存仅512MB、超时60秒，
// 在云函数内做PDF转图片+OCR会内存溢出/超时。扫描版PDF请使用「截图上传」功能。
// 如需自动识别，可接入腾讯云COS数据万象（文档预览转图片）或自建服务器。
async function handleScanPdf(fileBuffer) {
  console.log('[scanPdf] 检测到扫描版PDF，云函数环境不支持PDF转图片，建议截图上传');
  return { 
    success: false, 
    error: '扫描版PDF暂不支持自动识别。请打开PDF→逐页截图→使用「截图上传」功能。如需自动识别可接入腾讯云COS数据万象。' 
  };
}
