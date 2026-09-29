#!/usr/bin/env bash
# 常规推送脚本（需要能访问 github.com 的网络环境）
# 用法：bash tools/push.sh [仓库名]    默认仓库名 repo-insight
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_NAME="${1:-repo-insight}"
DESC="一键把 GitHub 仓库变成结构化解读 + 部署方案（Chrome MV3 扩展，隐私优先，支持本地 Ollama）"
TOPICS="chrome-extension,manifest-v3,github-tool,ai,llm,deepseek,ollama,code-analysis,developer-tools,markdown,privacy,local-first,productivity,repository-analysis,documentation,no-dependencies"

cd "$ROOT"

if ! command -v gh >/dev/null 2>&1; then
  echo "未安装 gh。请先安装 GitHub CLI，或手动执行："
  echo "  git remote add origin https://github.com/<你的用户名>/${REPO_NAME}.git"
  echo "  git push -u origin main"
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "gh 未登录，先执行：gh auth login -h github.com"
  exit 1
fi

if [ ! -d .git ]; then
  git init -q
fi
git add -A
if ! git diff --cached --quiet; then
  git commit -q -m "chore: 更新内容"
fi
git branch -M main

if git remote get-url origin >/dev/null 2>&1; then
  git push -u origin main
else
  gh repo create "$REPO_NAME" --public --source=. --push --description "$DESC"
fi

gh repo edit --add-topic "$TOPICS" || echo "（标签设置失败，可在仓库页手动添加）"
echo "完成：$(gh repo view --json url -q .url)"
