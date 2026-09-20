# 仓库协作约定（电路游戏 / mcu-circuit-laboratory）

## Git：未经明确命令，不做任何写操作

用户要求「git 那边统一等我命令再 commit」。因此：

- **禁止**在未被明确要求时执行任何会改变仓库状态的 git 命令：`commit`、`push`、`stash`、`checkout` / `restore`、`reset`、`revert`、`cherry-pick`、`merge`、`rebase`、`clean`、`branch -d`、`tag` 等。
- **允许**的只读命令：`status`、`diff`、`log`、`show`、`blame`、`fetch`（不改本地分支）等——查状态、看 diff 随时可以做，不用问。
- 需要回退或丢弃改动时，先说明方案与影响范围，征得同意后再执行；不要用 `git checkout -- .`、`git stash -u` 这类一次性吞掉全部改动的方式。
- 提交前先给出建议的提交范围与提交信息，等用户确认；用户可能要求代码与文档分开提交，**不要擅自 `git add -A`**。
- 用户明确下令（如「提交」「commit」「push」）后按其当次指定的范围执行。

## 仓库与本地环境

- 主分支 `main`，远程 `origin` = `gzxf77/mcu-circuit-laboratory`。
- `.dsh-profile-backup/` 是安装 DSH 插件前对 `~/.dsh/profiles/desktop` 的备份与 `rollback.sh`，已加入 `.gitignore`，不随仓库提交。
- 工作区之外（如 `~/.dsh/`）的写操作需要提权审批，且与本仓库无关。
