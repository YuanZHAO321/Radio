# 加密电台 · Radio

面向 iPhone / iPad 的离线电报 PWA：中文 ⇄ 四位电码转换，并按加密、解密。提供两套主题：**谍报**（暗夜卷宗）与 **二战**（战地电报纸）。

## 功能

- **明码**：汉字与标准中文电码（四码）互译，自动识别输入方向；支持简/繁；数字、字母、标点使用本机扩展码 `99xx`。
- **加密 / 解密**（加密规则）
  1. 明码：汉字 → 标准四码
  2. 密本：经保密代码本替代（0000–9999 置换，可关闭）
  3. 加乱：与乱数组逐位相加、不进位（解密逐位相减、不借位）
  4. 指标：报首一组 `PPRC`，示乱数自第 PP 页 R 行 C 列起用，并经指标乱数遮盖
  5. 校验：报尾一组，为全部明码不进位之和再加乱
  6. 一次一密：本机记录乱数用迹，重用告警；可按页段分配给收发双方
- **码本**：按页浏览标准电码本（大陆 / 台湾），查字查码。
- **乱数本**：由共同密钥派生的 100 页 × 100 组乱数，可逐页查看。
- **拍发**：以莫尔斯码播放电文组，指示灯同步闪烁。
- 全部运算在本机完成，首次打开后完全离线可用。

> 乱数由密钥经 PBKDF2-SHA256 + HMAC-SHA256 派生，属确定性流密码，强度取决于密钥。建议使用“随机生成”的 32 位数字密钥并当面交接。

## 安装到 iPhone / iPad

1. 用 Safari 打开网址 → 分享 → **添加到主屏幕**。
2. 打开一次后即可断网使用。

## 本地开发

```sh
npx http-server -p 8080 -c-1   # 打开 http://localhost:8080
node tests/hao.test.mjs            # 电码与加解密测试
```

电码数据由 `tools/build_codes.py` 从 Unicode Unihan 数据库（`kMainlandTelegraph` / `kTaiwanTelegraph`）生成：

```sh
curl -O https://www.unicode.org/Public/UCD/latest/ucd/Unihan.zip && unzip Unihan.zip -d unihan
python3 tools/build_codes.py unihan
```

修改 `Main` 下的资源后，请同步提升 `/sw.js` 中的 `VERSION`，以便已安装的设备更新缓存。
