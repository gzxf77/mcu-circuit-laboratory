# 仓库协作约定（电路游戏 / mcu-circuit-laboratory）

## Git：未经明确命令，不做任何写操作

用户要求「git 那边统一等我命令再 commit」。因此：

- **禁止**在未被明确要求时执行任何会改变仓库状态的 git 命令：`commit`、`push`、`stash`、`checkout` / `restore`、`reset`、`revert`、`cherry-pick`、`merge`、`rebase`、`clean`、`branch -d`、`tag` 等。
- **允许**的只读命令：`status`、`diff`、`log`、`show`、`blame`、`fetch`（不改本地分支）等——查状态、看 diff 随时可以做，不用问。
- 需要回退或丢弃改动时，先说明方案与影响范围，征得同意后再执行；不要用 `git checkout -- .`、`git stash -u` 这类一次性吞掉全部改动的方式。
- 提交前先给出建议的提交范围与提交信息，等用户确认；用户可能要求代码与文档分开提交，**不要擅自 `git add -A`**。
- 用户明确下令（如「提交」「commit」「push」）后按其当次指定的范围执行。

## 教材参考资料（《电路》第 6 版，邱关源）

- 扫描件在仓库根目录 `电路 第6版 (邱关源).pdf`（111 MB，545 页，**纯扫描、无文字层**；已在 `.gitignore` 忽略，不随仓库提交）。
- **一律用本机 OCR 读它**（用户决定）：`tools/pdfocr.swift` 用系统自带 PDFKit + Vision 识别，**图片不进模型上下文**，只读识别出的文本，实测约 0.7 秒/页。不要为了"读懂"逐页看图（那要 1.5–3k token/页），也不要为了抽文本去装 poppler/tesseract。
  - 构建一次：`swiftc -O -module-cache-path /tmp/swift-modcache tools/pdfocr.swift -o tools/pdfocr`（`tools/pdfocr` 二进制已忽略，不入库）
  - 用法：`./tools/pdfocr "电路 第6版 (邱关源).pdf" 17 23`（参数是 1 起的 PDF 页码；页头写 stderr，stdout 只有正文，便于 grep/重定向）
- 页码换算：**PDF 页 = 印刷页 + 24**（用第 2、4、5、6 章起始页校准过）。18 章的章首页码见 `教材页号索引.md`；小节页号用目录页 `grep` 得到。
- OCR 会认错公式、上下标与形近字，**不要把 OCR 出的公式直接落进关卡数据**：公式/数值必须精确时，只看那一页的图（或请用户截图）再确认。
- 只把**索引信息**（章节、页号、对符号约定与例题风格的对齐结论）写进仓库，不要把教材正文复制进仓库。

## 仓库与本地环境

- 主分支 `main`，远程 `origin` = `gzxf77/mcu-circuit-laboratory`。
- `.dsh-profile-backup/` 是安装 DSH 插件前对 `~/.dsh/profiles/desktop` 的备份与 `rollback.sh`，已加入 `.gitignore`，不随仓库提交。
- 工作区之外（如 `~/.dsh/`）的写操作需要提权审批，且与本仓库无关。
