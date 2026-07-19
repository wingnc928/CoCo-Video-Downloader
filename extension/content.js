// content.js - 针对抖音精选流深度重构的纯净嗅探引擎
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
      !!document.querySelector('[data-e2e="feed-active-video"] [class*="live"]')
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
        const videos = [];
        const seenUrls = new Set();

        // A. 提取当前主播放视频标题
        let pageTitle = "抖音视频";
        try {
          const selectors = [
            '[data-e2e="feed-active-video"] [data-e2e="video-desc"]',
            '.slider-video-itemActive [data-e2e="video-desc"]',
            '[data-e2e="video-desc"]',
            '.video-info-detail .video-title'
          ];
          
          for (const selector of selectors) {
            const node = document.querySelector(selector);
            if (node) {
              const text = node.innerText.trim();
              if (text && text.length > 2 && !/播放|次|评论|赞|下载|分享|客户端|登录|全部|抖音|Bilibili|哔哩哔哩|YouTube|Downloader/i.test(text)) {
                pageTitle = text;
                break;
              }
            }
          }
          // 2. 智能候选方案 A：通过话题符号（#）定位描述
          if (pageTitle === "抖音视频" || pageTitle.length < 3) {
            const candNodes = document.querySelectorAll('div, span, p, h1, h2');
            for (const cand of candNodes) {
              const text = cand.innerText.trim();
              if (text.includes('#') && text.length > 8 && text.length < 300) {
                if (!cand.closest('[class*="comment"]') && !cand.closest('[class*="sidebar"]') && !cand.closest('[class*="recommend"]')) {
                  pageTitle = text;
                  break;
                }
              }
            }
          }

          // 3. 智能候选方案 B：定位用户名账号标志（@）提取其描述
          if (pageTitle === "抖音视频" || pageTitle.length < 3) {
            const allNodes = document.querySelectorAll('*');
            for (const node of allNodes) {
              const text = node.innerText.trim();
              if (text.startsWith('@') && text.length > 1 && text.length < 40) {
                const parent = node.parentElement;
                if (parent) {
                  const descNode = parent.querySelector('[data-e2e="video-desc"]') || 
                                   parent.querySelector('[class*="desc"]') ||
                                   parent.querySelector('span');
                  if (descNode) {
                    const descText = descNode.innerText.trim();
                    if (descText && descText.length > 2 && !descText.startsWith('@')) {
                      pageTitle = descText;
                      break;
                    }
                  }
                }
              }
            }
          }
        } catch (e) {}

        // 如果页面元素没提取到合适标题，则从 document.title 提取并清洗
        if (pageTitle === "抖音视频" || !pageTitle || pageTitle.length < 3) {
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
        
        pageTitle = pageTitle.replace(/[\\/*?:"<>|\n\r]/g, "").substring(0, 50).trim();

        // 基础当前播放任务入队
        let cleanCurrentUrl = currentUrl;
        const currentModalMatch = currentUrl.match(/modal_id=(\d+)/);
        const currentVideoMatch = currentUrl.match(/(?:video|note)\/(\d+)/);
        if (currentModalMatch) {
          cleanCurrentUrl = `https://www.douyin.com/video/${currentModalMatch[1]}`;
        } else if (currentVideoMatch) {
          cleanCurrentUrl = `https://www.douyin.com/video/${currentVideoMatch[1]}`;
        }

        seenUrls.add(cleanCurrentUrl);
        videos.push({ url: cleanCurrentUrl, title: `【当前播放】${pageTitle}` });

        // 清洗文本的辅助函数
        const cleanText = (text) => {
          if (!text) return "";
          return text.replace(/\s+/g, " ")
                     .replace(/[\\/*?:"<>|\n\r]/g, "")
                     .trim();
        };

        // 智能获取元素的标题
        const getElementTitle = (el) => {
          const img = el.querySelector('img');
          if (img && img.alt && img.alt.trim().length > 2) {
            return cleanText(img.alt);
          }
          const textNodes = [];
          const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null, false);
          let node;
          while (node = walk.nextNode()) {
            const val = node.nodeValue.trim();
            if (val.length > 2 && 
                !/^\d+(\.\d+)?[万次]?$/.test(val) && 
                !/播放|赞|评论|分享|万|直播|时长|作者|订阅|关注|抖音|Bilibili|哔哩哔哩|YouTube|Downloader/i.test(val) &&
                !/^\d{1,2}:\d{2}(:\d{2})?$/.test(val)) {
              textNodes.push(val);
            }
          }
          if (textNodes.length > 0) {
            textNodes.sort((a, b) => b.length - a.length);
            return cleanText(textNodes[0]);
          }
          return cleanText(el.innerText);
        };

        // 1. 扫描所有 a 标签
        const aTags = document.querySelectorAll('a');
        aTags.forEach(a => {
          let url = a.href || a.getAttribute('data-href') || "";
          let videoId = "";
          
          const modalMatch = url.match(/modal_id=(\d+)/);
          const pathMatch = url.match(/(?:video|note)\/(\d+)/);
          
          if (modalMatch) {
            videoId = modalMatch[1];
          } else if (pathMatch) {
            videoId = pathMatch[1];
          }

          if (videoId) {
            const videoUrl = `https://www.douyin.com/video/${videoId}`;
            if (!seenUrls.has(videoUrl)) {
              let title = getElementTitle(a);
              if (!title || title.length < 2) {
                let parent = a.parentElement;
                for (let i = 0; i < 3 && parent; i++) {
                  title = getElementTitle(parent);
                  if (title && title.length >= 2) break;
                  parent = parent.parentElement;
                }
              }
              
              if (!title || title.length < 2) {
                title = `推荐视频_${videoId}`;
              }
              
              if (/登录|注册|协议|隐私|反馈|举报|全部|客户端|抖音|Bilibili|哔哩哔哩|YouTube|Downloader/i.test(title)) return;

              seenUrls.add(videoUrl);
              videos.push({ url: videoUrl, title: title.substring(0, 50) });
            }
          }
        });

        // 2. 扫描所有可能带有数字 ID 或 modal_id 的其他标签元素
        const allElements = document.querySelectorAll('div, li, [data-id], [data-video-id], [data-e2e]');
        allElements.forEach(el => {
          let videoId = "";
          
          for (let i = 0; i < el.attributes.length; i++) {
            const attr = el.attributes[i];
            const val = attr.value;
            if (!val) continue;

            const modalMatch = val.match(/modal_id=(\d+)/);
            const videoMatch = val.match(/(?:video|note)\/(\d+)/);
            const digitMatch = val.match(/\b(\d{18,22})\b/);

            let matchedId = "";
            if (modalMatch) matchedId = modalMatch[1];
            else if (videoMatch) matchedId = videoMatch[1];
            else if (digitMatch) matchedId = digitMatch[1];

            if (matchedId) {
              videoId = matchedId;
              break;
            }
          }

          if (videoId) {
            const videoUrl = `https://www.douyin.com/video/${videoId}`;
            if (!seenUrls.has(videoUrl)) {
              let title = getElementTitle(el);
              if (!title || title.length < 2) {
                title = `推荐视频_${videoId}`;
              }
              
              if (/登录|注册|协议|隐私|反馈|举报|全部|客户端|抖音|Bilibili|哔哩哔哩|YouTube|Downloader/i.test(title)) return;

              seenUrls.add(videoUrl);
              videos.push({ url: videoUrl, title: title.substring(0, 50) });
            }
          }
        });

        sendResponse({ videos: videos, pageTitle: pageTitle });
      };
      
      setTimeout(executeDouyin, 250);
      return true;
    }

    // ==========================================
    // 1.5. 快手特化通道
    // ==========================================
    if (currentHost.includes("kuaishou.com")) {
      const executeKuaishou = () => {
        const videos = [];
        const seenUrls = new Set();
        
        let pageTitle = document.title;
        // 清洗标题
        pageTitle = pageTitle.replace(/\s+-\s+快手.*/i, "")
                             .replace(/ - 快手.*/i, "")
                             .replace(/_快手.*/i, "")
                             .trim();
        pageTitle = pageTitle.replace(/[\\/*?:"<>|\n\r]/g, "").substring(0, 50).trim();
        if (!pageTitle) pageTitle = "快手视频";

        // 寻找页面上的 video 元素，包括 shadowRoot
        const videoEls = Array.from(document.querySelectorAll('video'));
        document.querySelectorAll('*').forEach(node => {
          if (node.shadowRoot) {
            videoEls.push(...Array.from(node.shadowRoot.querySelectorAll('video')));
          }
        });

        let directUrl = "";
        for (const video of videoEls) {
          let src = video.src || video.getAttribute('src') || video.currentSrc;
          if (src && src.startsWith('http')) {
            directUrl = src;
            break;
          }
        }

        // B. 如果没有找到 http 直链（可能是 blob），则从 script 脚本的页面初始状态提取
        if (!directUrl) {
          const scripts = document.querySelectorAll('script');
          for (const script of scripts) {
            let content = script.textContent;
            if (content && (content.includes('ndcimgs') || content.includes('yximgs') || content.includes('kwaicdn') || content.includes('playUrl'))) {
              content = content.replace(/\\\//g, '/')
                               .replace(/\\u002F/gi, '/')
                               .replace(/\\u0026/gi, '&')
                               .replace(/\\u003D/gi, '=')
                               .replace(/\\u003F/gi, '?');
              
              const matches = content.match(/(https?:\/\/[^\s"'\\]+\.mp4(?:\?[^\s"'\\]+)?)/gi);
              if (matches) {
                for (const url of matches) {
                  if (url.includes('ndcimgs.com') || url.includes('yximgs.com') || url.includes('kwaicdn.com') || url.includes('/upic/')) {
                    directUrl = url;
                    break;
                  }
                }
              }
            }
            if (directUrl) break;
          }
        }

        if (directUrl) {
          // 如果找到了直链，把直链作为主视频候选，并标为【当前播放】
          seenUrls.add(directUrl);
          videos.push({ url: directUrl, title: `【当前播放】${pageTitle}` });
        } else {
          // 没找到直链时退回到页面链接
          seenUrls.add(currentUrl);
          videos.push({ url: currentUrl, title: `【当前播放】${pageTitle}` });
        }

        // 搜寻页面上的其它快手视频/分享链接
        const aTags = document.querySelectorAll('a');
        aTags.forEach(a => {
          let url = a.href || "";
          if (url && (url.includes('/short-video/') || url.includes('/detail/')) && !seenUrls.has(url)) {
            let title = a.innerText.replace(/\s+/g, " ").trim();
            title = title.replace(/[\\/*?:"<>|\n\r]/g, "").substring(0, 50).trim();
            if (title && title.length > 2 && !/登录|注册|协议|隐私|反馈|举报|全部|客户端/i.test(title)) {
              seenUrls.add(url);
              videos.push({ url: url, title: title });
            }
          }
        });

        sendResponse({ videos: videos, pageTitle: pageTitle });
      };

      setTimeout(executeKuaishou, 250);
      return true;
    }

    // ==========================================
    // 1.8. 头条特化通道
    // ==========================================
    if (currentHost.includes("toutiao.com")) {
      const executeToutiao = () => {
        const videos = [];
        const seenUrls = new Set();

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

        // 主播放视频入队
        seenUrls.add(currentUrl);
        videos.push({ url: currentUrl, title: `【当前播放】${pageTitle}` });

        // 扫描页面上的推荐视频链接，并智能洗出最长标题
        const allLinks = document.querySelectorAll('a');
        allLinks.forEach(a => {
          let href = a.href || "";
          if (!href) return;
          
          const isToutiaoVideo = href.includes('/video/') || href.includes('/group/');
          if (isToutiaoVideo && !seenUrls.has(href)) {
            let title = "";
            
            // 方案 A：从 a 标签内部寻找，过滤掉时间、播放量等噪音
            const textNodes = [];
            const walk = document.createTreeWalker(a, NodeFilter.SHOW_TEXT, null, false);
            let node;
            while (node = walk.nextNode()) {
              const val = node.nodeValue.trim();
              if (val.length > 2 && 
                  !/^\d+(\.\d+)?[万次]?$/.test(val) && 
                  !/播放|赞|评论|分享|万|直播|时长|作者|订阅|关注|头条/i.test(val) &&
                  !/^\d{1,2}:\d{2}(:\d{2})?$/.test(val)) {
                textNodes.push(val);
              }
            }
            if (textNodes.length > 0) {
              textNodes.sort((a, b) => b.length - a.length);
              title = textNodes[0];
            }

            // 方案 B：如果 A 没找到，向上在父级容器寻找合适的标题元素
            if (!title || title.length < 3) {
              let parent = a.parentElement;
              for (let i = 0; i < 3 && parent; i++) {
                const titleEl = parent.querySelector('[class*="title" i], [class*="name" i]');
                if (titleEl) {
                  const val = titleEl.innerText.trim();
                  if (val.length > 3 && !/^\d{1,2}:\d{2}/.test(val)) {
                    title = val;
                    break;
                  }
                }
                parent = parent.parentElement;
              }
            }

            // 过滤噪音后写入
            if (title) {
              title = title.replace(/[\\/*?:"<>|\n\r]/g, "").substring(0, 50).trim();
              if (title && title.length > 2 && !/广告|协议|隐私|反馈|版权|登录|注册/.test(title)) {
                seenUrls.add(href);
                videos.push({ url: href, title: title });
              }
            }
          }
        });

        sendResponse({ videos: videos, pageTitle: pageTitle });
      };

      setTimeout(executeToutiao, 250);
      return true;
    }

    // ==========================================
    // 2. 1000+ 通用平台采集通道（保持不变）
    // ==========================================
    const executeGeneric = () => {
      const videos = [];
      const seenUrls = new Set();

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

      seenUrls.add(currentUrl);
      videos.push({ url: currentUrl, title: `【当前播放】${pageTitle}` });

      const mediaTags = findNodesEverywhere('video, source, iframe, [data-video-src]');
      for (const media of mediaTags) {
        let mediaUrl = media.src || media.getAttribute('src') || media.getAttribute('data-video-src');
        if (!mediaUrl && media.tagName.toLowerCase() === 'video') mediaUrl = media.currentSrc;
        
        if (mediaUrl && mediaUrl.startsWith('http') && !seenUrls.has(mediaUrl)) {
          if (/\.(mp4|m3u8|mpd|flv|webm|mp3|m4a|wav|aac|ogg)(\?|#|$)/i.test(mediaUrl) || mediaUrl.includes('player')) {
            seenUrls.add(mediaUrl);
            videos.push({ url: mediaUrl, title: `【探测到媒体流】${pageTitle}` });
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

        if (isVideoGeneric && !seenUrls.has(href)) {
          let linkTitle = a.innerText.replace(/\s+/g, " ").trim();
          if (!linkTitle || linkTitle.length < 3) {
            const img = a.querySelector('img');
            if (img && img.alt) linkTitle = img.alt.trim();
          }
          if (!linkTitle || /广告|协议|隐私|版权|登录|注册/.test(linkTitle)) continue;

          // 过滤纯时间、播放量、仅数字等噪音标题（如 "02:12"），避免其提早占位导致真实的视频标题被 seenUrls 忽略
          if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(linkTitle) || 
              /^\d+(\.\d+)?[万次]?$/.test(linkTitle) || 
              /^\d+$/.test(linkTitle) ||
              linkTitle.length < 2) {
            continue;
          }

          linkTitle = linkTitle.replace(/[\\/*?:"<>|\n\r]/g, "").substring(0, 50).trim();
          seenUrls.add(href);
          videos.push({ url: href, title: linkTitle });
        }
      }

      sendResponse({ videos: videos, pageTitle: pageTitle });
    };

    setTimeout(executeGeneric, 250);
  }
  return true;
});