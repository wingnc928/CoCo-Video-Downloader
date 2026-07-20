const SERVER = 'http://127.0.0.1:18080';

// 动态抓取当前网站的所有顶级和次级 cookies，序列化为标准的 Netscape 文本格式
async function getActiveTabCookies(tabUrl) {
  try {
    const cookies = await chrome.cookies.getAll({ url: tabUrl });
    let cookieText = "# Netscape HTTP Cookie File\n";
    cookies.forEach(c => {
      const flag = c.hostOnly ? "FALSE" : "TRUE";
      const secure = c.secure ? "TRUE" : "FALSE";
      const expiration = c.expirationDate ? Math.floor(c.expirationDate) : 0;
      
      let cDomain = c.domain;
      if (!cDomain.startsWith('.') && !c.hostOnly) {
          cDomain = '.' + cDomain;
      }
      cookieText += `${cDomain}\t${flag}\t${c.path}\t${secure}\t${expiration}\t${c.name}\t${c.value}\n`;
    });
    return cookieText;
  } catch (e) {
    console.error('Failed to export cookies via Extension API', e);
    return "";
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  const urlEl = document.getElementById('url');
  const btn = document.getElementById('download-btn');
  const progress = document.getElementById('progress');
  const status = document.getElementById('status');
  const formatSel = document.getElementById('format');
  const offlineBanner = document.getElementById('server-offline');
  
  const listContainer = document.getElementById('video-list-container');
  const listItems = document.getElementById('list-items');
  const selectAllBtn = document.getElementById('select-all');

  const toggleManagerBtn = document.getElementById('toggle-manager-btn');
  const managerPanel = document.getElementById('manager-panel');
  const managerListItems = document.getElementById('manager-list-items');
  const mainWorkflowBlock = document.getElementById('main-workflow-block');

  let currentUrl = '';
  let activeTabId = null;
  let targetVideos = []; 
  let managerInterval = null;
  let currentTabTitle = '视频下载';

  // 1. 获取当前活跃标签页信息
  try {
    const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
    currentUrl = tab.url || '';
    activeTabId = tab.id;
    urlEl.textContent = currentUrl;
    
    if (tab.title) {
      currentTabTitle = tab.title.split('_')[0].split('-')[0].trim();
    }
  } catch (e) {
    urlEl.textContent = 'Unable to get page URL';
  }

  // 1.5 本地直播链接直接拦截
  const isLiveUrl = (
    currentUrl.includes("live.douyin.com") || 
    currentUrl.includes("live.bilibili.com") || 
    (currentUrl.includes("youtube.com") && currentUrl.includes("/live")) || 
    currentUrl.includes("/live/") || 
    currentUrl.includes("/live-stream")
  );

  if (isLiveUrl) {
    urlEl.style.display = 'block';
    urlEl.style.maxHeight = '140px';
    urlEl.style.border = '2px solid #ff4757';
    urlEl.style.backgroundColor = '#2a1a1a';
    urlEl.style.padding = '10px';
    urlEl.style.borderRadius = '6px';
    urlEl.style.margin = '10px 0';
    
    btn.disabled = true;
    btn.style.background = '#333';
    btn.style.color = '#777';
    btn.textContent = `直播间禁止下载`;

    urlEl.innerHTML = `
      <span style="color: #ff4757; font-weight: bold; font-size: 13px;">🚫 警告：当前页面为直播间</span><br>
      <span style="color: #ff4757; font-weight: bold; font-size: 12px; display: block; margin-top: 4px; border: 1px dashed #ff4757; padding: 4px; background: rgba(255, 71, 87, 0.1);">【注：系统不支持下载直播实时流】</span>
      <span style="color: #bbb; font-size: 11px; display: block; margin-top: 4px;">由于直播流是无限时长且处于实时推送状态，本下载器无法直接下载。请选择已播完录制的常规视频。</span>
    `;
    return;
  }

  // 1.6 抖音精选/推荐大厅流拦截提示
  let isDouyinFeed = false;
  try {
    const urlObj = new URL(currentUrl);
    isDouyinFeed = urlObj.hostname.includes("douyin.com") && (
      (urlObj.pathname.includes("/jingxuan") && !urlObj.searchParams.has("modal_id")) ||
      urlObj.searchParams.has("recommend") ||
      urlObj.pathname === "/"
    ) && !urlObj.pathname.includes("/video/") && !urlObj.pathname.includes("/note/");
  } catch (e) {
    isDouyinFeed = false;
  }

  if (isDouyinFeed) {
    urlEl.style.display = 'block';
    urlEl.style.maxHeight = '180px';
    urlEl.style.border = '2px solid #ffa502';
    urlEl.style.backgroundColor = '#2a241a';
    urlEl.style.padding = '10px';
    urlEl.style.borderRadius = '6px';
    urlEl.style.margin = '10px 0';
    
    btn.disabled = true;
    btn.style.background = '#333';
    btn.style.color = '#777';
    btn.textContent = `等待切换到视频详情页...`;

    urlEl.innerHTML = `
      <span style="color: #ffa502; font-weight: bold; font-size: 13px;">⚠️ 提示：当前处于推荐/精选流</span><br>
      <span style="color: #e0e0e0; font-size: 11px; display: block; margin-top: 4px; line-height: 1.4;">当前页面无法直接下载。请在想要下载的视频卡片上<strong style="color: #409eff;">右键点击“进入详情页”</strong>（或在右下角进入详情页），即可在该视频详情页下载。</span>
      <div style="margin-top: 6px; padding: 5px 8px; background: rgba(255, 71, 87, 0.15); border: 1px dashed #ff4757; border-radius: 4px;">
        <span style="color: #ff4757; font-weight: bold; font-size: 12px; display: block;">🚫 重点提醒：直播不支持下载！</span>
      </div>
    `;
    return;
  }

  // 2. 服务器健康检查
  let serverAlive = false;
  try {
    const r = await fetch(SERVER + '/health', {method: 'GET', mode: 'cors'});
    if (r.ok) serverAlive = true;
  } catch (e) {
    serverAlive = false;
  }

  if (!serverAlive) {
    offlineBanner.style.display = 'block';
    btn.disabled = true;
    status.textContent = 'Waiting for server...';
    status.style.color = '#ff4757';
    return;
  }

// 3. 唤醒内容脚本，动态扫描当前网页中的批量视频链接
  if (activeTabId && currentUrl.startsWith('http')) {
    try {
      chrome.tabs.sendMessage(activeTabId, { action: "scan_videos" }, (response) => {
        if (chrome.runtime.lastError) {
          console.log("[INFO] 页面通信管道尚未就绪，已安全忽略:", chrome.runtime.lastError.message);
          return;
        }

        if (response) {
          // ======= 【核心优化：对抖音推荐大厅与直播应用强制拦截并醒目突显】 =======
          const isLiveError = response.error && response.error.includes("不支持下载");
          const isDouyinRecommend = currentUrl.includes('douyin.com') && currentUrl.includes('?recommend=');

          if (isLiveError) {
            urlEl.style.display = 'block';
            urlEl.style.maxHeight = '140px';
            urlEl.style.border = '2px solid #ff4757';
            urlEl.style.backgroundColor = '#2a1a1a';
            urlEl.style.padding = '10px';
            urlEl.style.borderRadius = '6px';
            urlEl.style.margin = '10px 0';
            
            btn.disabled = true;
            btn.style.background = '#333';
            btn.style.color = '#777';
            btn.textContent = `直播间禁止下载`;

            urlEl.innerHTML = `
              <span style="color: #ff4757; font-weight: bold; font-size: 13px;">🚫 警告：当前页面为直播间</span><br>
              <span style="color: #ff4757; font-weight: bold; font-size: 12px; display: block; margin-top: 4px; border: 1px dashed #ff4757; padding: 4px; background: rgba(255, 71, 87, 0.1);">【注：系统不支持下载直播实时流】</span>
              <span style="color: #bbb; font-size: 11px; display: block; margin-top: 4px;">由于直播流是无限时长且处于实时推送状态，本下载器无法直接下载。请切换至普通视频详情页再进行下载。</span>
            `;
            return;
          }

          if (isDouyinRecommend) {
            urlEl.style.display = 'block';
            urlEl.style.maxHeight = '180px';
            
            btn.disabled = true;
            btn.style.background = '#333';
            btn.style.color = '#777';
            btn.textContent = `等待切换到视频详情页...`;

            urlEl.innerHTML = `
              <span style="color: #ffa502; font-weight: bold; font-size: 13px;">⚠️ 提示：当前处于推荐/精选流</span><br>
              <span style="color: #e0e0e0; font-size: 11px; display: block; margin-top: 4px; line-height: 1.4;">推荐大厅无法直接下载，请在视频卡片上<strong style="color: #409eff;">右键点击“进入详情页”</strong>（或在右下角进入详情页）继续下载。</span>
              <div style="margin-top: 6px; padding: 5px 8px; background: rgba(255, 71, 87, 0.15); border: 1px dashed #ff4757; border-radius: 4px;">
                <span style="color: #ff4757; font-weight: bold; font-size: 12px; display: block;">🚫 重点提醒：直播不支持下载！</span>
              </div>
            `;
            return;
          }
          // ====================================================

          // 通用页面逻辑：恢复按钮状态，允许点击下载
          btn.disabled = false;
          btn.style.background = ''; 
          btn.style.color = '';

          if (response.pageTitle) {
            currentTabTitle = response.pageTitle;
          }

          if (response.videos && response.videos.length > 0) {
            targetVideos = response.videos;
            listContainer.style.display = 'block';
            urlEl.style.display = 'none'; 
            btn.textContent = `批量下载已选视频`;

            listItems.innerHTML = '';
            targetVideos.forEach((vid, index) => {
              const div = document.createElement('div');
              div.className = 'batch-item';
              div.innerHTML = `
                <input type="checkbox" id="vid-${index}" value="${vid.url}" checked>
                <label for="vid-${index}">${vid.title}</label>
              `;
              listItems.appendChild(div);
            });
          }
        }
      });
    } catch (err) {
      console.log("[INFO] 强行捕获边缘环境错位:", err.message);
    }
  }

  // 4. 批量全选 / 反选逻辑
  if (selectAllBtn) {
    selectAllBtn.addEventListener('click', (e) => {
      e.preventDefault();
      const checkboxes = listItems.querySelectorAll('input[type="checkbox"]');
      const allChecked = Array.from(checkboxes).every(cb => cb.checked);
      checkboxes.forEach(cb => cb.checked = !allChecked);
    });
  }

  // 5. 暴露全局操作函数，向后端发送控制指令
  window.handleJobAction = async (jobId, action) => {
    try {
      await fetch(SERVER + '/job_action', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ job_id: jobId, action: action })
      });
      fetchAndRenderJobs(); 
    } catch (e) {
      console.error("Action failed", e);
    }
  };

  // 6. 任务中心看板切换与高频轮询机制
  toggleManagerBtn.addEventListener('click', () => {
    if (managerPanel.style.display === 'none' || managerPanel.style.display === '') {
      managerPanel.style.display = 'block';
      mainWorkflowBlock.style.display = 'none';
      toggleManagerBtn.textContent = '返回下载页面';
      
      const headerEl = document.getElementById('manager-header') || managerPanel;
      if (!document.getElementById('cancel-all-btn')) {
        const cancelAllBtn = document.createElement('button');
        cancelAllBtn.id = 'cancel-all-btn';
        cancelAllBtn.textContent = '全部取消';
        cancelAllBtn.style.cssText = 'font-size: 11px; background: #ff4757; color: white; border: none; padding: 3px 8px; border-radius: 4px; cursor: pointer; font-weight: bold;';
        cancelAllBtn.onclick = async () => {
          if (confirm('确定要强行取消所有正在进行的任务吗？')) {
            await fetch(SERVER + '/cancel_all', { method: 'POST' });
            fetchAndRenderJobs();
          }
        };
        headerEl.appendChild(cancelAllBtn);
      }

      fetchAndRenderJobs();
      managerInterval = setInterval(fetchAndRenderJobs, 1000);
    } else {
      managerPanel.style.display = 'none';
      mainWorkflowBlock.style.display = 'block';
      toggleManagerBtn.textContent = '查看任务中心';
      if (managerInterval) clearInterval(managerInterval);
    }
  });

  // 7. 从服务端拉取活动任务状态并重绘看板
  async function fetchAndRenderJobs() {
    try {
      const res = await fetch(SERVER + '/jobs', { method: 'GET', mode: 'cors' });
      const jobs = await res.json();
      
      const jobIds = Object.keys(jobs);
      if (jobIds.length === 0) {
        managerListItems.innerHTML = '<div style="text-align:center; color:#555; padding:20px 0;">暂无正在进行的后台任务</div>';
        return;
      }

      jobIds.sort((a, b) => new Date(jobs[b].started) - new Date(jobs[a].started));
      managerListItems.innerHTML = '';
      
      jobIds.forEach(id => {
        const job = jobs[id];
        const item = document.createElement('div');
        item.className = 'manager-item';

        let color = '#aaa';
        if (job.status === 'Completed') color = '#4caf50';
        if (job.status === 'Error' || job.status === 'Cancelled') color = '#ff4757';
        if (job.status === 'Downloading') color = '#2ed573';
        if (job.status === 'Paused') color = '#ffa502';

        let metaText = `状态: <span style="color:${color}">${job.status}</span>`;
        if (job.status === 'Downloading') {
          metaText += ` | 进度: ${job.progress.toFixed(1)}%`;
          if (job.speed && job.speed !== '-') metaText += ` | ${job.speed}`;
        }
        if (job.error && job.status === 'Error') {
          metaText += ` <br><span style="color:#ff4757; font-size:10px;">原因: ${job.error.substring(0,45)}...</span>`;
        }

        const titleToShow = (job.title && job.title !== '-') ? job.title : job.url.substring(0, 40) + '...';

        item.innerHTML = `
          <div class="manager-item-title" title="${job.url}">${titleToShow}</div>
          <div class="manager-item-meta">${metaText}</div>
          <div class="manager-item-actions" id="actions-${id}" style="margin-top: 6px; text-align: right;"></div>
        `;
        managerListItems.appendChild(item);

        const actionsContainer = item.querySelector(`#actions-${id}`);
        if (job.status === 'Downloading') {
            const pauseBtn = document.createElement('button');
            pauseBtn.textContent = '⏸ 暂停';
            pauseBtn.style.cssText = 'margin-right: 5px; padding: 2px 8px; cursor: pointer; background: #ffa502; color: #fff; border: none; border-radius: 3px; font-size: 12px;';
            pauseBtn.onclick = () => handleJobAction(id, 'pause');
            
            const cancelBtn = document.createElement('button');
            cancelBtn.textContent = '⏹ 取消';
            cancelBtn.style.cssText = 'padding: 2px 8px; cursor: pointer; background: #ff4757; color: #fff; border: none; border-radius: 3px; font-size: 12px;';
            cancelBtn.onclick = () => handleJobAction(id, 'cancel');
            
            actionsContainer.appendChild(pauseBtn);
            actionsContainer.appendChild(cancelBtn);
        } else if (job.status === 'Paused') {
            const resumeBtn = document.createElement('button');
            resumeBtn.textContent = '▶ 继续';
            resumeBtn.style.cssText = 'margin-right: 5px; padding: 2px 8px; cursor: pointer; background: #2ed573; color: #fff; border: none; border-radius: 3px; font-size: 12px;';
            resumeBtn.onclick = () => handleJobAction(id, 'resume');
            
            const cancelBtn = document.createElement('button');
            cancelBtn.textContent = '⏹ 取消';
            cancelBtn.style.cssText = 'padding: 2px 8px; cursor: pointer; background: #ff4757; color: #fff; border: none; border-radius: 3px; font-size: 12px;';
            cancelBtn.onclick = () => handleJobAction(id, 'cancel');
            
            actionsContainer.appendChild(resumeBtn);
            actionsContainer.appendChild(cancelBtn);
        }
      });
    } catch (e) {
      console.error("Failed to query jobs from server", e);
    }
  }

  // 8. 初始化格式偏好加载
  const saved = await chrome.storage.local.get(['defaultFormat']);
  if (saved.defaultFormat) formatSel.value = saved.defaultFormat;

  document.getElementById('settings-link').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  // 9. 执行下载派发核心逻辑
  btn.addEventListener('click', async () => {
    if (btn.disabled || !currentUrl) return;

    const isLivePage = currentUrl.includes('/live/') || document.querySelector('[data-e2e="live-room"]');
    if (isLivePage) {
      status.textContent = '当前页面为直播间，不支持下载！';
      status.style.color = '#ff4757';
      return;
    }

    let urlsToDownload = [];
    const checkboxes = listItems.querySelectorAll('input[type="checkbox"]:checked');
    if (checkboxes.length > 0) {
      checkboxes.forEach(cb => urlsToDownload.push(cb.value));
    } else {
      let processedUrl = currentUrl;
      const douyinModal = currentUrl.match(/modal_id=(\d+)/);
      if (douyinModal) {
        processedUrl = `https://www.douyin.com/video/${douyinModal[1]}`;
      }
      urlsToDownload.push(processedUrl);
    }

    if (urlsToDownload.length === 0) {
      status.textContent = '请至少勾选一个视频！';
      status.style.color = '#ff4757';
      return;
    }

    btn.disabled = true;
    progress.style.width = '0%';
    status.textContent = 'Extracting cookies...';
    
    const cookieData = await getActiveTabCookies(currentUrl);
    let successCount = 0;
    
    for (let i = 0; i < urlsToDownload.length; i++) {
      const targetUrl = urlsToDownload[i];
      let matchedTitle = "";
      
      if (targetVideos.length > 0) {
        const found = targetVideos.find(v => v.url === targetUrl);
        if (found) matchedTitle = found.title;
      }
      if (!matchedTitle) {
        matchedTitle = currentTabTitle;
      }

      status.textContent = `正在提交任务 (${i + 1}/${urlsToDownload.length})...`;

      try {
        const resp = await fetch(SERVER + '/download', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({
            url: targetUrl,
            format: formatSel.value,
            cookie_data: cookieData,
            title: encodeURIComponent(matchedTitle)
          })
        });

        if (resp.ok) successCount++;
      } catch (err) {
        console.error('Batch submit error', err);
      }
    }

    btn.disabled = false;
    if (successCount > 0) {
      status.textContent = `已成功向后台派发 ${successCount} 个任务！`;
      status.style.color = '#4caf50';
      progress.style.width = '100%';
      
      setTimeout(() => { toggleManagerBtn.click(); }, 800);
    } else {
      status.textContent = '任务提交失败。';
      status.style.color = '#ff4757';
    }
  });
});