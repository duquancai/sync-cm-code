const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const fetch = require("node-fetch");

const SRC_REPO = "https://github.com/cmliu/edgetunnel.git";
const LOCAL_REPO = "edgetunnel";
const LAST_COMMIT_FILE = "last_commit.txt";
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const GH_TOKEN = process.env.GH_TOKEN;

// 使用 token 认证的仓库 URL
function getAuthenticatedRepoUrl() {
  if (GH_TOKEN) {
    return `https://x-access-token:${GH_TOKEN}@github.com/cmliu/edgetunnel.git`;
  }
  return SRC_REPO;
}

async function sendTelegramMessage(text) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.log("Telegram 配置缺失，跳过发送消息");
    return;
  }
  
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ 
        chat_id: TELEGRAM_CHAT_ID, 
        text,
        parse_mode: "HTML"
      }),
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    console.log("✅ Telegram 消息发送成功");
  } catch (error) {
    console.error("发送 Telegram 消息失败:", error);
  }
}

function getLatestCommits() {
  const repoUrl = getAuthenticatedRepoUrl();
  try {
    console.log("获取最新 commits...");
    const output = execSync(`git ls-remote ${repoUrl} refs/heads/*`, { 
      encoding: "utf8",
      timeout: 30000 
    });
    return output.trim();
  } catch (error) {
    console.error("获取最新 commits 失败:", error);
    throw error;
  }
}

function readLastCommits() {
  if (fs.existsSync(LAST_COMMIT_FILE)) {
    return fs.readFileSync(LAST_COMMIT_FILE, "utf8").trim();
  }
  return "";
}

function writeLastCommits(data) {
  fs.writeFileSync(LAST_COMMIT_FILE, data);
}

function getAllBranches() {
  const repoUrl = getAuthenticatedRepoUrl();
  try {
    console.log("获取所有分支...");
    const output = execSync(`git ls-remote --heads ${repoUrl}`, { 
      encoding: "utf8",
      timeout: 30000 
    });
    const branches = output.trim().split('\n')
      .filter(line => line)
      .map(line => line.split('\t')[1].replace('refs/heads/', ''));
    console.log(`找到 ${branches.length} 个分支:`, branches);
    return branches;
  } catch (error) {
    console.error("获取分支失败:", error);
    throw error;
  }
}

function syncRepo() {
  const repoUrl = getAuthenticatedRepoUrl();
  
  try {
    // 清理本地仓库
    if (fs.existsSync(LOCAL_REPO)) {
      console.log("清理现有本地仓库...");
      execSync(`rm -rf ${LOCAL_REPO}`);
    }
    
    // 克隆仓库（包含所有分支）
    console.log("开始克隆仓库（所有分支）...");
    execSync(`git clone --bare ${repoUrl} ${LOCAL_REPO}`, { 
      stdio: "inherit",
      timeout: 120000 
    });
    
    console.log("✅ 仓库克隆完成");
    
  } catch (error) {
    console.error("❌ 同步失败:", error);
    throw error;
  }
}

function copyBranchFiles(branch) {
  try {
    console.log(`📋 处理分支: ${branch}`);
    
    // 创建分支目录
    const branchDir = `branches/${branch}`;
    if (fs.existsSync(branchDir)) {
      execSync(`rm -rf ${branchDir}`);
    }
    fs.mkdirSync(branchDir, { recursive: true });
    
    // 检出分支文件
    execSync(`cd ${LOCAL_REPO} && git archive --format=tar ${branch} | tar -x -C ../${branchDir}`, {
      stdio: "inherit",
      shell: true
    });
    
    console.log(`✅ 分支 ${branch} 文件已提取到 ${branchDir}`);
    
    // 创建分支信息文件
    const branchInfo = {
      branch: branch,
      lastSync: new Date().toISOString(),
      commit: execSync(`cd ${LOCAL_REPO} && git rev-parse ${branch}`, { encoding: 'utf8' }).trim()
    };
    
    fs.writeFileSync(`${branchDir}/branch-info.json`, JSON.stringify(branchInfo, null, 2));
    
  } catch (error) {
    console.error(`❌ 处理分支 ${branch} 失败:`, error);
  }
}

function createBranchesIndex(branches) {
  const indexContent = `
# Edgetunnel 所有分支同步

本仓库自动同步 [cmliu/edgetunnel](https://github.com/cmliu/edgetunnel) 的所有分支。

## 可用分支

${branches.map(branch => `- [${branch}](./branches/${branch}/)`).join('\n')}

## 最后同步时间

${new Date().toISOString()}

> 此仓库通过 GitHub Actions 自动同步，每天检查更新。
  `.trim();
  
  fs.writeFileSync('BRANCHES.md', indexContent);
}

(async function main() {
  try {
    console.log("🔍 检查更新...");
    const latest = getLatestCommits();
    const last = readLastCommits();
    
    console.log("上次 commits:", last ? "有记录" : "无记录");
    console.log("最新 commits:", latest ? "有更新" : "无数据");
    
    if (latest !== last) {
      console.log("🔄 检测到更新，开始同步...");
      
      // 同步仓库
      syncRepo();
      
      // 获取所有分支
      const branches = getAllBranches();
      
      // 清理旧的 branches 目录
      if (fs.existsSync('branches')) {
        execSync(`rm -rf branches`);
      }
      
      // 为每个分支提取文件
      console.log("开始提取各分支文件...");
      for (const branch of branches) {
        copyBranchFiles(branch);
      }
      
      // 创建分支索引文件
      createBranchesIndex(branches);
      
      // 更新 commit 记录
      writeLastCommits(latest);
      
      await sendTelegramMessage(`✅ edgetunnel 仓库有更新，已同步 ${branches.length} 个分支。\n\n分支列表:\n${branches.map(b => `• ${b}`).join('\n')}`);
      console.log(`📝 已同步 ${branches.length} 个分支`);
      
    } else {
      console.log("🔹 无更新，无需同步。");
    }
  } catch (error) {
    console.error("❌ 执行失败:", error);
    await sendTelegramMessage(`❌ 同步失败: ${error.message}`);
    process.exit(1);
  }
})();