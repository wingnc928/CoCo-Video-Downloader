import json
import re

from yt_dlp.extractor.common import InfoExtractor
from yt_dlp.utils import (
    clean_html,
    try_call,
    url_or_none,
)


class KuaishouIE(InfoExtractor):
    IE_NAME = 'kuaishou'
    IE_DESC = '快手短视频'
    _VALID_URL = r'https?://(?:www\.)?kuaishou\.com/(?:short-video|photo|video|detail|profile/[^/]+[?&]photoId=)(?P<id>[a-zA-Z0-9_-]+)'

    def _real_extract(self, url):
        video_id = self._match_id(url)
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Referer': 'https://www.kuaishou.com/',
        }

        webpage = self._download_webpage(url, video_id, headers=headers, fatal=False) or ''

        # 1. 提取视频标题
        title = self._og_search_title(webpage, default=None)
        if not title:
            title_m = re.search(r'<title>(.*?)</title>', webpage)
            if title_m:
                title = clean_html(title_m.group(1))
                title = re.sub(r'\s*-\s*快手.*', '', title).strip()
        if not title:
            title = f'快手视频_{video_id}'

        # 2. 尝试解析 HTML 及解密 INIT_STATE 数据
        all_text = webpage
        init_m = re.search(r'window\.INIT_STATE\s*=\s*(\{.+?\});?</script>', webpage)
        if init_m:
            try:
                decoded_init = "".join(chr(ord(c) - 1) for c in init_m.group(1))
                all_text += "\n" + decoded_init
            except Exception:
                pass

        mp4_urls = re.findall(r'https?://[^\s"\'<>]+\.mp4[^\s"\'<>]*', all_text)
        if not mp4_urls:
            mp4_urls = [u.replace('\\/', '/') for u in re.findall(r'https?:\\/\\/[^\s"\'<>]+\.mp4[^\s"\'<>]*', all_text)]

        clean_mp4s = []
        for u in mp4_urls:
            clean_u = u.split('\\')[0].split('"')[0].split("'")[0]
            if url_or_none(clean_u) and clean_u not in clean_mp4s:
                clean_mp4s.append(clean_u)

        if clean_mp4s:
            best_url = clean_mp4s[0]
            for u in clean_mp4s:
                if 'kwai' in u or 'kuaishou' in u:
                    best_url = u
                    break
            return {
                'id': video_id,
                'title': title,
                'url': best_url,
                'ext': 'mp4',
            }

        # 3. 发起 GraphQL API visionVideoDetail 接口请求
        graphql_url = 'https://www.kuaishou.com/graphql'
        payload = {
            "operationName": "visionVideoDetail",
            "variables": {
                "photoId": video_id,
                "page": "detail"
            },
            "query": "query visionVideoDetail($photoId: String, $type: String, $page: String, $webPageType: String) { visionVideoDetail(photoId: $photoId, type: $type, page: $page, webPageType: $webPageType) { status photo { id caption photoUrl mainMvUrls { url } } } }"
        }
        res_json = self._download_json(graphql_url, video_id, data=json.dumps(payload).encode('utf-8'), headers={
            'Content-Type': 'application/json',
            'Referer': f'https://www.kuaishou.com/short-video/{video_id}',
        }, fatal=False)

        if res_json and isinstance(res_json, dict):
            photo = try_call(lambda: res_json['data']['visionVideoDetail']['photo'])
            if photo:
                caption = photo.get('caption') or title
                mv_urls = photo.get('mainMvUrls') or []
                if mv_urls and isinstance(mv_urls, list) and mv_urls[0].get('url'):
                    return {
                        'id': video_id,
                        'title': caption,
                        'url': mv_urls[0]['url'],
                        'ext': 'mp4',
                    }

        # 4. 容错保底：直接返回拼接的标准短视频页面 URL
        return {
            'id': video_id,
            'title': title,
            'url': f'https://www.kuaishou.com/short-video/{video_id}',
            'ext': 'mp4',
        }
