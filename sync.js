const { execSync } = require("child_process");
const fs = require("fs");
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

function parseCommitsData(commitsText) {
  const lines = commitsText.split('\n').filter(line => line.trim());
  const commits = {};
  
  lines.forEach(line => {
    const [hash, ref] = line.split('\t');
    const branch = ref.replace('refs/heads/', '');
    commits[branch] = hash;
  });
  
  return commits;
}

// 获取分支的最后提交时间
async function getBranchCommitTime(branch, commitHash) {
  try {
    const apiUrl = `https://api.github.com/repos/cmliu/edgetunnel/commits/${commitHash}`;
    const headers = {
      'Accept': 'application/vnd.github.v3+json'
    };
    
    if (GH_TOKEN) {
      headers['Authorization'] = `token ${GH_TOKEN}`;
    }
    
    const response = await fetch(apiUrl, { headers });
    
    if (!response.ok) {
      throw new Error(`GitHub API 错误: ${response.status}`);
    }
    
    const commitData = await response.json();
    return new Date(commitData.commit.committer.date);
  } catch (error) {
    console.warn(`无法获取分支 ${branch} 的提交时间:`, error.message);
    return new Date(0); // 如果获取失败，返回最早的时间
  }
}

// 获取仓库的最后更新时间
async function getRepoLastUpdateTime() {
  try {
    const apiUrl = `https://api.github.com/repos/cmliu/edgetunnel`;
    const headers = {
      'Accept': 'application/vnd.github.v3+json'
    };
    
    if (GH_TOKEN) {
      headers['Authorization'] = `token ${GH_TOKEN}`;
    }
    
    const response = await fetch(apiUrl, { headers });
    
    if (!response.ok) {
      throw new Error(`GitHub API 错误: ${response.status}`);
    }
    
    const repoData = await response.json();
    // 返回仓库的 pushed_at 时间，这是最后推送时间
    return new Date(repoData.pushed_at);
  } catch (error) {
    console.warn(`无法获取仓库更新时间:`, error.message);
    return new Date(); // 如果获取失败，返回当前时间
  }
}

async function getChangedBranches(oldCommits, newCommits) {
  const changedBranches = [];
  
  for (const [branch, newHash] of Object.entries(newCommits)) {
    const oldHash = oldCommits[branch];
    if (oldHash !== newHash) {
      const commitTime = await getBranchCommitTime(branch, newHash);
      changedBranches.push({
        branch,
        oldHash,
        newHash,
        commitTime,
        url: `https://github.com/cmliu/edgetunnel/tree/${branch}`
      });
    }
  }
  
  // 检查是否有新增分支
  for (const branch of Object.keys(newCommits)) {
    if (!oldCommits[branch]) {
      const commitTime = await getBranchCommitTime(branch, newCommits[branch]);
      changedBranches.push({
        branch,
        oldHash: null,
        newHash: newCommits[branch],
        commitTime,
        url: `https://github.com/cmliu/edgetunnel/tree/${branch}`,
        isNew: true
      });
    }
  }
  
  // 按照提交时间从旧到新排序（最新的排在最后面）
  changedBranches.sort((a, b) => a.commitTime - b.commitTime);
  
  return changedBranches;
}

function syncRepo() {
  const repoUrl = getAuthenticatedRepoUrl();
  
  try {
    // 清理本地仓库
    if (fs.existsSync(LOCAL_REPO)) {
      console.log("清理现有本地仓库...");
      execSync(`rm -rf ${LOCAL_REPO}`);
    }
    
    // 克隆仓库
    console.log("开始克隆仓库...");
    execSync(`git clone --mirror ${repoUrl} ${LOCAL_REPO}`, { 
      stdio: "inherit",
      timeout: 120000 
    });
    
    console.log("✅ 同步完成");
    
  } catch (error) {
    console.error("❌ 同步失败:", error);
    throw error;
  }
}

(async function main() {
  try {
    console.log("🔍 检查更新...");
    const latestText = getLatestCommits();
    const lastText = readLastCommits();
    
    console.log("上次 commits:", lastText ? "有记录" : "无记录");
    console.log("最新 commits:", latestText ? "有数据" : "无数据");
    
    if (latestText !== lastText) {
      console.log("🔄 检测到更新，开始同步...");
      
      const oldCommits = lastText ? parseCommitsData(lastText) : {};
      const newCommits = parseCommitsData(latestText);
      const changedBranches = await getChangedBranches(oldCommits, newCommits);
      
      // 获取仓库的实际最后更新时间
      const repoUpdateTime = await getRepoLastUpdateTime();
      const updateTimeString = repoUpdateTime.toLocaleString('zh-CN', { 
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
      
      syncRepo();
      writeLastCommits(latestText);
      
      // 构建 Telegram 消息
      let message = "✅ <b>edgetunnel 仓库已更新</b>\n\n";
      
      if (changedBranches.length > 0) {
        message += "<b>更新的分支 (按更新时间排序):</b>\n";
        changedBranches.forEach(({ branch, oldHash, newHash, commitTime, url, isNew }) => {
          const shortOldHash = oldHash ? oldHash.substring(0, 7) : '无';
          const shortNewHash = newHash.substring(0, 7);
          const commitTimeString = commitTime.toLocaleString('zh-CN', { 
            timeZone: 'Asia/Shanghai',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
          });
          
          if (isNew) {
            message += `🆕 <b>${branch}</b> (新增分支)\n`;
          } else {
            message += `🔁 <b>${branch}</b>\n`;
            message += `   ${shortOldHash} → ${shortNewHash}\n`;
          }
          message += `   🕐 ${commitTimeString}\n`;
          message += `   🔗 <a href="${url}">查看分支</a>\n\n`;
        });
      } else {
        message += "检测到变化但无法确定具体更新的分支。\n\n";
      }
           
      await sendTelegramMessage(message);
      console.log("📝 已更新 last_commit.txt 文件");
      console.log(`⏰ 仓库最后更新时间: ${updateTimeString}`);
    } else {
      console.log("🔹 无更新，无需同步。");
      // 无更新时不发送 Telegram 消息
    }
  } catch (error) {
    console.error("❌ 执行失败:", error);
    await sendTelegramMessage(`❌ 同步失败: ${error.message}`);
    process.exit(1);
  }
})();