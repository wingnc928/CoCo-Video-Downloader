// content.js - 针对多平台深度重构的纯净嗅探引擎

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "scan_videos") {
    
    const currentHost = window.location.hostname;
    const currentUrl = window.location.href;

    // 全局直播流检测机制
    const isLiveDouyin = currentHost.includes("douyin.com") && (
      currentUrl.includes("live.douyin.com") || 
      currentUrl.includes("/live/") ||
      !!document.querySelector('[data-e2e="live-room"]') || 
      !!document.querySelector('.slider-video-itemActive [class*="live"]') ||
      !!document.querySelector('[data-e2e="feed-active-video"] [class*="live"]') ||
      !!document.querySelector('.xgplayer-is-live') ||
      !!document.querySelector('.living-container') ||
      !!(document.querySelector('.slider-video-itemActive') && (document.querySelector('.slider-video-itemActive').innerText || "").includes("直播中")) ||
      !!(document.querySelector('[data-e2e="feed-active-video"]') && (document.querySelector('[data-e2e="feed-active-video"]').innerText || "").includes("直播中"))
    );

    const isLiveBilibili = currentHost.includes("bilibili.com") && (
      currentUrl.includes("live.bilibili.com") || 
      !!document.querySelector('.live-room-app') || 
      !!document.querySelector('#player-ctnr[class*="live"]')
    );

    const isLiveYoutube = currentHost.includes("youtube.com") && (
      currentUrl.includes("/live") || 
      !!document.querySelector('.ytp-live') || 
      !!document.querySelector('.ytp-live-badge')
    );

    const isGenericLive = currentUrl.includes('/live/') || currentUrl.includes('/live-stream');

    if (isLiveDouyin || isLiveBilibili || isLiveYoutube || isGenericLive) {
      sendResponse({ error: "当前内容为直播流，系统不支持直播实时下载！" });
      return true;
    }

    // ==========================================
    // 全局核心视频数据缓存与智能去噪匹配引擎
    // ==========================================
    const videoMap = new Map();

    // 清洗文本的辅助函数
    const cleanText = (text) => {
      if (!text) return "";
      return text.replace(/\s+/g, " ")
                 .replace(/[\\/*?:"<>|\n\r]/g, "")
                 .trim();
    };

    // 智能获取元素的标题（优先抽取最丰富完整描述，降级使用 img.alt）
    const getElementTitle = (el) => {
      if (!el) return "";

      const textNodes = [];
      const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null, false);
      let node;
      while (node = walk.nextNode()) {
        const val = node.nodeValue.trim();
        // 过滤常见 UI 标签、时间格式、纯数字、播放量
        if (val.length >= 2 && 
            !/^\d+(\.\d+)?[万次]?$/.test(val) && 
            !/播放|赞|评论|分享|万|直播|时长|作者|订阅|关注|抖音|Bilibili|哔哩哔哩|YouTube|Downloader|今日头条|头条/i.test(val) &&
            !/^\d{1,2}:\d{2}(:\d{2})?$/.test(val) &&
            !/年前|月前|天前|小时前|分钟前|秒前|刚刚|昨天|前天/i.test(val) &&
            !/^\d{2,4}[-/.年]\d{1,2}[-/.月]\d{1,2}/.test(val) &&
            !/^\d{1,2}[-/.月]\d{1,2}/.test(val) &&
            !/\d+\s*(秒|s)\s*后(即将)?播放/i.test(val)) {
          textNodes.push(val);
        }
      }

      if (textNodes.length > 0) {
        // 按长度降序，优先寻找带有话题标签 #、分隔符 |、书名号《》或第X集的完整丰富描述
        textNodes.sort((a, b) => b.length - a.length);
        for (const t of textNodes) {
          if (t.length > 5 && (t.includes('#') || t.includes('|') || t.includes('《') || /第\d+集/.test(t))) {
            return cleanText(t);
          }
        }
        
        const combined = textNodes.slice(0, 3).join(" ").replace(/\s+/g, " ").trim();
        if (combined.length >= 3) {
          return cleanText(combined);
        }
      }

      // 仅当 DOM 内部无文本节点时，再降级使用 img.alt
      const img = el.querySelector('img');
      if (img && img.alt && img.alt.trim().length > 2) {
        return cleanText(img.alt);
      }

      return "";
    };

    const primaryVideoUrls = new Set();

    const addVideo = (url, title, isPrimary = false) => {
      if (!url) return;
      
      // 解析相对 URL 路径为绝对路径
      let cleanUrl = url.trim();
      if (cleanUrl.startsWith('//')) {
        cleanUrl = window.location.protocol + cleanUrl;
      } else if (cleanUrl.startsWith('/')) {
        cleanUrl = window.location.origin + cleanUrl;
      }
      
      // 清洗标题
      let cleanTitle = title ? cleanText(title) : "";
      if (!cleanTitle || cleanTitle.length < 2) {
        const matchId = cleanUrl.match(/(?:short-video|photo|video|detail|group|modal_id=|\/v\/|\/video\/|photoId=|\/status\/)([a-zA-Z0-9_-]+)/i);
        const vid = matchId ? matchId[1] : (videoMap.size + 1).toString();
        cleanTitle = `视频作品_${vid}`;
      }

      // 过滤常见噪音页标题
      if (/广告|协议|隐私|反馈|版权|登录|注册|全部|客户端/i.test(cleanTitle)) return;

      const isCurrentNumeric = /^\d+$/.test(cleanTitle);
      const isCurrentTime = /^\d{1,2}\d{2}$/.test(cleanTitle);
      const isCurrentGeneric = cleanTitle.startsWith('推荐视频_') || cleanTitle.startsWith('视频_') || cleanTitle.startsWith('短视频_') || cleanTitle.startsWith('视频作品_');
      
      if (isPrimary) {
        // 主播放器提取的权威标题：强制写入并锁定，禁止后续侧边栏扫描覆盖！
        primaryVideoUrls.add(cleanUrl);
        videoMap.set(cleanUrl, cleanTitle);
        return;
      }

      // 如果该视频 URL 已经被主播放器标记为权威标题，绝不允许侧边栏或推荐卡片覆盖！
      if (primaryVideoUrls.has(cleanUrl)) {
        return;
      }

      if (!videoMap.has(cleanUrl)) {
        videoMap.set(cleanUrl, cleanTitle);
      } else {
        const existingTitle = videoMap.get(cleanUrl);
        const isExistingNumeric = /^\d+$/.test(existingTitle);
        const isExistingTime = /^\d{1,2}\d{2}$/.test(existingTitle);
        const isExistingGeneric = existingTitle.startsWith('推荐视频_') || existingTitle.startsWith('视频_') || existingTitle.startsWith('短视频_') || existingTitle.startsWith('视频作品_');
        let override = false;
        
        if ((isExistingGeneric || isExistingNumeric || isExistingTime) && (!isCurrentGeneric && !isCurrentNumeric && !isCurrentTime)) {
          override = true;
        } else if (!isCurrentNumeric && !isCurrentTime && !isCurrentGeneric) {
          // 如果后续扫描到了更详细丰富的全量描述（如包含 #、|、《》或字数明显更长），自动升级标题
          if (cleanTitle.length > existingTitle.length + 4 && (cleanTitle.includes('#') || cleanTitle.includes('|') || cleanTitle.includes('《') || /第\d+集/.test(cleanTitle))) {
            override = true;
          }
        }
        
        if (override) {
          videoMap.set(cleanUrl, cleanTitle);
        }
      }
    };

    // ==========================================
    // 1. 抖音特化全闭环通道
    // ==========================================
    if (currentHost.includes("douyin.com")) {
      const isLive = document.querySelector('[data-e2e="live-room"]') || 
                     document.querySelector('.slider-video-itemActive [class*="live"]') ||
                     document.querySelector('[data-e2e="feed-active-video"] [class*="live"]');
                     
      if (isLive) {
        sendResponse({ error: "当前内容为直播流，系统不支持直播实时下载！" });
        return true;
      }

      const executeDouyin = () => {
        // A. 提取当前主播放视频标题（优先提炼全量描述文本）
        let pageTitle = "";
        try {
          const selectors = [
            '[data-e2e="feed-active-video"] [data-e2e="video-desc"]',
            '.slider-video-itemActive [data-e2e="video-desc"]',
            '[data-e2e="video-desc"]',
            '[class*="video-desc"]',
            '[class*="video-info"] [class*="title"]',
            '.video-info-detail .video-title',
            'h1[class*="title"]'
          ];
          
          for (const selector of selectors) {
            const nodes = document.querySelectorAll(selector);
            for (const node of nodes) {
              // 关键修缮：绝对排除右侧推荐栏、侧边栏及评论区中的节点，防止抓到第65集等卡片标题
              if (node.closest('[class*="sidebar"]') || node.closest('[class*="recommend"]') || node.closest('[class*="comment"]') || node.closest('[class*="right"]')) {
                continue;
              }
              let text = (node.innerText || node.textContent || "").trim();
              text = text.replace(/展开|收起|@\S+/g, "").trim();
              if (text && text.length > 2 && !/^[\d\s\W]+$/.test(text)) {
                pageTitle = text;
                break;
              }
            }
            if (pageTitle) break;
          }

          if (!pageTitle || pageTitle.length < 3) {
            const candNodes = document.querySelectorAll('span[class*="title"], div[class*="desc"], p[class*="desc"], h1, h2');
            for (const cand of candNodes) {
              if (cand.closest('[class*="sidebar"]') || cand.closest('[class*="recommend"]') || cand.closest('[class*="comment"]') || cand.closest('[class*="right"]')) {
                continue;
              }
              const text = (cand.innerText || "").trim();
              if ((text.includes('#') || /第\d+集/.test(text)) && text.length > 4 && text.length < 250) {
                pageTitle = text.replace(/展开|收起/g, "").trim();
                break;
              }
            }
          }
        } catch (e) {}

        if (!pageTitle || pageTitle.length < 3) {
          let fallback = document.title || "";
          fallback = fallback.replace(/\s+-\s+抖音.*/i, "")
                             .replace(/ - 抖音.*/i, "")
                             .replace(/_抖音.*/i, "")
                             .replace(/ - 哔哩哔哩.*/i, "")
                             .replace(/_哔哩哔哩.*/i, "")
                             .replace(/ - YouTube.*/i, "")
                             .trim();
          if (fallback && fallback.length > 2 && !/抖音|Bilibili|哔哩哔哩|YouTube/i.test(fallback)) {
            pageTitle = fallback;
          }
        }
        
        pageTitle = pageTitle.replace(/[\\/*?:"<>|\n\r]/g, "").substring(0, 80).trim();
        if (!pageTitle) pageTitle = "抖音视频";

        // 基础当前播放任务入队 (通用支持 /video/、/note/、modal_id= 以及 /user/ 页面弹窗下的 vid=)
        const isCurrentUrlVideo = currentUrl.includes('/video/') || currentUrl.includes('/note/') || currentUrl.includes('modal_id=') || currentUrl.includes('vid=');
        if (isCurrentUrlVideo) {
          let cleanCurrentUrl = currentUrl;
          const currentVidMatch = currentUrl.match(/vid=(\d+)/);
          const currentModalMatch = currentUrl.match(/modal_id=(\d+)/);
          const currentVideoMatch = currentUrl.match(/(?:video|note)\/(\d+)/);
          
          if (currentVidMatch && currentVidMatch[1]) {
            cleanCurrentUrl = `https://www.douyin.com/video/${currentVidMatch[1]}`;
          } else if (currentModalMatch && currentModalMatch[1]) {
            cleanCurrentUrl = `https://www.douyin.com/video/${currentModalMatch[1]}`;
          } else if (currentVideoMatch && currentVideoMatch[1]) {
            cleanCurrentUrl = `https://www.douyin.com/video/${currentVideoMatch[1]}`;
          }
          addVideo(cleanCurrentUrl, pageTitle, true);
        }

        // 1. 扫描所有 a 标签（全域匹配 vid=, modal_id=, /video/ 及长数字指纹）
        const aTags = document.querySelectorAll('a');
        aTags.forEach(a => {
          let url = a.href || a.getAttribute('data-href') || a.getAttribute('href') || "";
          let videoId = "";
          const vidMatch = url.match(/vid=(\d+)/);
          const modalMatch = url.match(/modal_id=(\d+)/);
          const pathMatch = url.match(/(?:video|note)\/(\d+)/);
          const digitMatch = url.match(/\b(\d{18,22})\b/);
          
          if (vidMatch) videoId = vidMatch[1];
          else if (modalMatch) videoId = modalMatch[1];
          else if (pathMatch) videoId = pathMatch[1];
          else if (digitMatch) videoId = digitMatch[1];

          if (videoId) {
            const videoUrl = `https://www.douyin.com/video/${videoId}`;
            // 核心修缮：从节点的父级向上寻径寻找真正的外层卡片容器，跳过节点自身
            const parentContext = a.parentElement || a;
            const cardWrapper = parentContext.closest('[class*="item" i], [class*="card" i], [class*="video" i], li') || parentContext;
            let title = getElementTitle(cardWrapper);
            if (!title || title.length < 2) {
              title = getElementTitle(a);
            }
            if (!title || title.length < 2) title = `推荐视频_${videoId}`;
            addVideo(videoUrl, title);
          }
        });

        // 2. 扫描所有可能带有数字 ID 或 modal_id / vid 的其他标签元素
        const allElements = document.querySelectorAll('div, li, [data-id], [data-video-id], [data-e2e]');
        allElements.forEach(el => {
          let videoId = "";
          for (let i = 0; i < el.attributes.length; i++) {
            const attr = el.attributes[i];
            const val = attr.value;
            if (!val) continue;

            const vidMatch = val.match(/vid=(\d+)/);
            const modalMatch = val.match(/modal_id=(\d+)/);
            const videoMatch = val.match(/(?:video|note)\/(\d+)/);
            const digitMatch = val.match(/\b(\d{18,22})\b/);

            if (vidMatch) { videoId = vidMatch[1]; break; }
            else if (modalMatch) { videoId = modalMatch[1]; break; }
            else if (videoMatch) { videoId = videoMatch[1]; break; }
            else if (digitMatch) { videoId = digitMatch[1]; break; }
          }

          if (videoId) {
            const videoUrl = `https://www.douyin.com/video/${videoId}`;
            const parentContext = el.parentElement || el;
            const cardWrapper = parentContext.closest('[class*="item" i], [class*="card" i], [class*="video" i], li') || parentContext;
            let title = getElementTitle(cardWrapper);
            if (!title || title.length < 2) {
              title = getElementTitle(el);
            }
            if (!title || title.length < 2) title = `推荐视频_${videoId}`;
            addVideo(videoUrl, title);
          }
        });

        const finalVideos = Array.from(videoMap.entries()).map(([url, title]) => ({ url, title }));
        sendResponse({ videos: finalVideos, pageTitle: pageTitle });
      };
      
      setTimeout(executeDouyin, 250);
      return true;
    }

    // ==========================================
    // 1.5. 快手特化通道
    // ==========================================
    if (currentHost.includes("kuaishou.com")) {
      let retryCount = 0;
      const executeKuaishou = () => {
        let pageTitle = document.title;
        pageTitle = pageTitle.replace(/\s+-\s+快手.*/i, "")
                             .replace(/ - 快手.*/i, "")
                             .replace(/_快手.*/i, "")
                             .trim();
        pageTitle = pageTitle.replace(/[\\/*?:"<>|\n\r]/g, "").substring(0, 50).trim();
        if (!pageTitle) pageTitle = "快手视频";

        const videoEls = Array.from(document.querySelectorAll('video'));
        document.querySelectorAll('*').forEach(node => {
          if (node.shadowRoot) {
            videoEls.push(...Array.from(node.shadowRoot.querySelectorAll('video')));
          }
        });

        // 智能甄别主/活动播放器，避免把卡片缩略图小播放器错认为主视频
        let bestVideo = null;
        let maxScore = -1;
        let directUrl = "";
        let activePhotoId = "";

        for (const video of videoEls) {
          let src = video.src || video.getAttribute('src') || video.currentSrc || "";
          
          let score = 0;
          const rect = video.getBoundingClientRect();
          const area = rect.width * rect.height;
          if (area > 0) score += area;
          if (!video.paused) score += 100000;
          
          let parent = video.parentElement;
          let isPlayerParent = false;
          for (let i = 0; i < 7 && parent; i++) {
            const classStr = (parent.className || "").toString().toLowerCase();
            if (classStr.includes('player') || classStr.includes('modal') || classStr.includes('detail') || classStr.includes('active') || classStr.includes('popup') || classStr.includes('slide')) {
              isPlayerParent = true;
              break;
            }
            parent = parent.parentElement;
          }
          if (isPlayerParent) score += 500000;
          
          if (score > maxScore) {
            maxScore = score;
            bestVideo = video;
          }
        }

        if (bestVideo) {
          let src = bestVideo.src || bestVideo.getAttribute('src') || bestVideo.currentSrc || "";
          if (src && src.startsWith('http')) {
            directUrl = src;
          }

          let modalTitle = "";
          let parent = bestVideo.parentElement;
          for (let i = 0; i < 10 && parent; i++) {
            const classStr = (parent.className || "").toString().toLowerCase();
            if (classStr.includes('modal') || classStr.includes('player') || classStr.includes('play-container') || classStr.includes('popup') || classStr.includes('detail') || classStr.includes('slide')) {
              if (!modalTitle) {
                modalTitle = getElementTitle(parent);
              }
            }

            // 在当前活动的播放器弹窗节点属性中提取 photoId
            let attrText = "";
            if (parent.attributes) {
              for (let a = 0; a < parent.attributes.length; a++) {
                attrText += " " + parent.attributes[a].name + "=" + parent.attributes[a].value;
              }
            }
            const matchPid = attrText.match(/(?:short-video\/|photo\/|video\/|detail\/|photoId=|photo_|workId=|\/fw\/photo\/)([a-zA-Z0-9_-]{6,32})/i);
            if (matchPid && matchPid[1] && matchPid[1] !== 'SEARCH' && matchPid[1] !== 'undefined' && matchPid[1] !== 'null') {
              activePhotoId = matchPid[1];
            }

            parent = parent.parentElement;
          }

          if (modalTitle && modalTitle.length >= 3 && !/^\d+$/.test(modalTitle)) {
            pageTitle = modalTitle;
          }
        }

        // 检查 URL 或者是活动弹窗中搜寻到的作品 ID
        if (!activePhotoId) {
          const urlMatch = currentUrl.match(/(?:short-video\/|photo\/|video\/|detail\/|photoId=)([a-zA-Z0-9_-]{6,32})/i);
          if (urlMatch && urlMatch[1] && urlMatch[1] !== 'SEARCH') {
            activePhotoId = urlMatch[1];
          }
        }

        if (activePhotoId) {
          const photoUrl = `https://www.kuaishou.com/short-video/${activePhotoId}`;
          addVideo(photoUrl, pageTitle, true);
        } else if (directUrl) {
          addVideo(directUrl, pageTitle, true);
        } else if (currentUrl.includes('/short-video/') || currentUrl.includes('/detail/') || currentUrl.includes('/photo/')) {
          addVideo(currentUrl, pageTitle, true);
        }

        // 提取作者 ID（防止误把作者 ID 当作作品 ID）
        const authorIdMatch = currentUrl.match(/\/profile\/([a-zA-Z0-9_-]+)/);
        const authorId = authorIdMatch ? authorIdMatch[1] : "";

        // 深度搜寻页面上的其它快手视频/卡片/分享链接（支持全 DOM 元素及所有属性深度捕获）
        const candElements = document.querySelectorAll('*');
        candElements.forEach(el => {
          let attrText = "";
          if (el.href) attrText += " " + el.href;
          if (el.src) attrText += " " + el.src;
          if (el.attributes) {
            for (let i = 0; i < el.attributes.length; i++) {
              attrText += " " + el.attributes[i].name + "=" + el.attributes[i].value;
            }
          }

          // 正则抽取 photoId / videoId
          const matches = attrText.matchAll(/(?:short-video\/|photo\/|video\/|detail\/|photoId=|photo_|workId=|\/fw\/photo\/)([a-zA-Z0-9_-]{6,32})/gi);
          for (const m of matches) {
            const pid = m[1];
            if (!pid || pid === authorId || pid === 'undefined' || pid === 'null' || pid === 'SEARCH') continue;
            
            const videoUrl = `https://www.kuaishou.com/short-video/${pid}`;
            let title = getElementTitle(el);
            if (!title || title.length < 2 || /^\d+$/.test(title) || /^\d{1,2}:\d{2}/.test(title)) {
              let parent = el.parentElement;
              for (let i = 0; i < 5 && parent; i++) {
                title = getElementTitle(parent);
                if (title && title.length >= 2 && !/^\d+$/.test(title) && !/^\d{1,2}:\d{2}/.test(title)) break;
                parent = parent.parentElement;
              }
            }
            addVideo(videoUrl, title);
          }
        });

        // 修复：移除会引发 ReferenceError 的未定义变量 interceptedVideosMap
        if (typeof interceptedVideosMap !== "undefined" && interceptedVideosMap) {
          interceptedVideosMap.forEach((title, url) => {
            addVideo(url, title);
          });
        }

        const finalVideos = Array.from(videoMap.entries()).map(([url, title]) => ({ url, title }));
        if (finalVideos.length === 0 && retryCount < 3) {
          retryCount++;
          setTimeout(executeKuaishou, 350);
        } else {
          sendResponse({ videos: finalVideos, pageTitle: pageTitle });
        }
      };

      setTimeout(executeKuaishou, 150);
      return true;
    }

    // ==========================================
    // 1.8. 头条特化通道
    // ==========================================
    if (currentHost.includes("toutiao.com")) {
      const executeToutiao = () => {
        let pageTitle = document.title;
        const ogTitle = document.querySelector('meta[property="og:title"]');
        if (ogTitle && ogTitle.getAttribute('content')) {
          pageTitle = ogTitle.getAttribute('content').trim();
        }
        pageTitle = pageTitle.replace(/\s+-\s+今日头条.*/i, "")
                             .replace(/ - 今日头条.*/i, "")
                             .replace(/_今日头条.*/i, "")
                             .trim();
        pageTitle = pageTitle.replace(/[\\/*?:"<>|\n\r]/g, "").substring(0, 50).trim();
        if (!pageTitle) pageTitle = "头条视频";

        // 主播放视频入队 (仅当处于视频详情/播放页时)
        const isCurrentUrlVideo = currentUrl.includes('/video/') || currentUrl.includes('/group/');
        if (isCurrentUrlVideo) {
          addVideo(currentUrl, pageTitle, true);
        }

        // 1. 扫描所有 a 标签
        const allLinks = document.querySelectorAll('a');
        allLinks.forEach(a => {
          let href = a.href || a.getAttribute('href') || a.getAttribute('data-href') || "";
          if (!href) return;
          
          const isToutiaoVideo = href.includes('/video/') || href.includes('/group/');
          if (isToutiaoVideo) {
            let title = getElementTitle(a);
            if (!title || title.length < 2 || /^\d+$/.test(title) || /^\d{1,2}:\d{2}/.test(title)) {
              let parent = a.parentElement;
              for (let i = 0; i < 4 && parent; i++) {
                title = getElementTitle(parent);
                if (title && title.length >= 2 && !/^\d+$/.test(title) && !/^\d{1,2}:\d{2}/.test(title)) break;
                parent = parent.parentElement;
              }
            }
            
            if (title) {
              addVideo(href, title);
            }
          }
        });

        // 2. 扫描所有含有头条视频ID或URL路径的其它标签元素 (针对动态 div 卡片)
        const allElements = document.querySelectorAll('div, li, [data-id], [data-video-id], [class*="card" i], [class*="item" i]');
        allElements.forEach(el => {
          let videoUrl = "";
          let videoId = "";
          
          for (let i = 0; i < el.attributes.length; i++) {
            const attr = el.attributes[i];
            const val = attr.value;
            if (!val) continue;

            const videoMatch = val.match(/(?:video|group)\/(\d{18,21})/);
            const digitMatch = val.match(/\b(\d{18,21})\b/);

            if (videoMatch) {
              videoId = videoMatch[1];
              break;
            } else if (digitMatch) {
              videoId = digitMatch[1];
              break;
            }
          }

          if (videoId) {
            videoUrl = `https://www.toutiao.com/video/${videoId}/`;
          }

          if (videoUrl) {
            let title = getElementTitle(el);
            if (!title || title.length < 2 || /^\d+$/.test(title) || /^\d{1,2}:\d{2}/.test(title)) {
              let parent = el.parentElement;
              for (let i = 0; i < 4 && parent; i++) {
                title = getElementTitle(parent);
                if (title && title.length >= 2 && !/^\d+$/.test(title) && !/^\d{1,2}:\d{2}/.test(title)) break;
                parent = parent.parentElement;
              }
            }
            
            if (!title || title.length < 2) {
              title = `推荐视频_${videoId}`;
            }
            
            addVideo(videoUrl, title);
          }
        });

        const finalVideos = Array.from(videoMap.entries()).map(([url, title]) => ({ url, title }));
        sendResponse({ videos: finalVideos, pageTitle: pageTitle });
      };

      setTimeout(executeToutiao, 250);
      return true;
    }

    // ==========================================
    // 2. 1000+ 通用平台采集通道
    // ==========================================
    const executeGeneric = () => {
      let pageTitle = document.title;
      const ogTitle = document.querySelector('meta[property="og:title"]');
      if (ogTitle && ogTitle.getAttribute('content')) {
        pageTitle = ogTitle.getAttribute('content').trim();
      }
      pageTitle = pageTitle.split('_')[0].split('-')[0].replace(/[\\/*?:"<>|\n\r]/g, "").trim();
      if (!pageTitle) pageTitle = "网络视频";
      pageTitle = pageTitle.substring(0, 50);

      const findNodesEverywhere = (selector) => {
        const elements = Array.from(document.querySelectorAll(selector));
        const allNodes = document.querySelectorAll('*');
        for (const node of allNodes) {
          if (node.shadowRoot) {
            elements.push(...Array.from(node.shadowRoot.querySelectorAll(selector)));
          }
        }
        return elements;
      };

      // 仅当含有真实的 <video> 标签或视频 URL 指征时，才认为该页是正在播放的视频
      const hasVideoTag = document.querySelector('video') !== null;
      const isLikelyVideoUrl = /\b(watch\?v=|shorts\/|video\/|group\/|detail\/|short-video\/|photo\/|play\/)\b/i.test(currentUrl) || 
                               /\.(mp4|m3u8|flv|webm|mp3|m4a)(\?|#|$)/i.test(currentUrl);
      if (hasVideoTag || isLikelyVideoUrl) {
        addVideo(currentUrl, pageTitle);
      }

      const mediaTags = findNodesEverywhere('video, source, iframe, [data-video-src]');
      for (const media of mediaTags) {
        let mediaUrl = media.src || media.getAttribute('src') || media.getAttribute('data-video-src');
        if (!mediaUrl && media.tagName.toLowerCase() === 'video') mediaUrl = media.currentSrc;
        
        if (mediaUrl && mediaUrl.startsWith('http')) {
          if (/\.(mp4|m3u8|mpd|flv|webm|mp3|m4a|wav|aac|ogg)(\?|#|$)/i.test(mediaUrl) || mediaUrl.includes('player')) {
            addVideo(mediaUrl, pageTitle);
          }
        }
      }

      const allLinks = findNodesEverywhere('a, [data-href]');
      for (const a of allLinks) {
        let href = a.href || a.getAttribute('data-href');
        if (!href || href.startsWith('javascript:') || href === currentUrl) continue;
        if (href.startsWith('/')) href = window.location.origin + href;

        const isVideoGeneric = href.includes('/video/') || 
                               href.includes('/watch?v=') || 
                               href.includes('/watch/') || 
                               href.includes('/shorts/') || 
                               href.includes('/p/') ||        
                               href.includes('/status/') ||   
                               /\.(mp4|m3u8|flv|webm|mp3|m4a)(\?|#|$)/i.test(href);

        if (isVideoGeneric) {
          let linkTitle = a.innerText.replace(/\s+/g, " ").trim();
          if (!linkTitle || linkTitle.length < 3) {
            const img = a.querySelector('img');
            if (img && img.alt) linkTitle = img.alt.trim();
          }
          
          if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(linkTitle) || 
              /^\d+(\.\d+)?[万次]?$/.test(linkTitle) || 
              /^\d+$/.test(linkTitle) ||
              linkTitle.length < 2) {
            continue;
          }
          addVideo(href, linkTitle);
        }
      }

      const finalVideos = Array.from(videoMap.entries()).map(([url, title]) => ({ url, title }));
      sendResponse({ videos: finalVideos, pageTitle: pageTitle });
    };

    setTimeout(executeGeneric, 250);
  }
  return true;
});