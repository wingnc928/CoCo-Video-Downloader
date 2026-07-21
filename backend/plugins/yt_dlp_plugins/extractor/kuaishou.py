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
    _VALID_URL = r'https?://(?:[a-zA-Z0-9_]+\.)?kuaishou\.com/(?:(?:short-video|photo|video|detail)/|profile/[^/]+[?&]photoId=)?(?P<id>[a-zA-Z0-9_-]+)'

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

        media_url = None
        ext = 'mp4'

        # 2. 尝试提取 window.__APOLLO_STATE__ (现代快手核心网页数据结构)
        apollo_m = re.search(r'window\.__APOLLO_STATE__\s*=\s*', webpage)
        if apollo_m:
            try:
                decoder = json.JSONDecoder()
                apollo_data, _ = decoder.raw_decode(webpage[apollo_m.end():])
                client = apollo_data.get('defaultClient', {})
                
                photo = None
                photo_key = f"VisionVideoDetailPhoto:{video_id}"
                if photo_key in client:
                    photo = client[photo_key]
                else:
                    for k, v in client.items():
                        if k.startswith("VisionVideoDetailPhoto:"):
                            photo = v
                            break

                if photo and isinstance(photo, dict):
                    if photo.get('caption'):
                        title = photo['caption']

                    # 首选 photoUrl (通常为最高清 MP4 直链)
                    if photo.get('photoUrl') and url_or_none(photo['photoUrl']):
                        media_url = photo['photoUrl']
                        ext = 'mp4'

                    # 次选 representation m3u8/mp4 流地址
                    if not media_url:
                        def find_url_in_obj(d):
                            if isinstance(d, dict):
                                if 'url' in d and isinstance(d['url'], str) and url_or_none(d['url']):
                                    return d['url']
                                for v in d.values():
                                    res = find_url_in_obj(v)
                                    if res:
                                        return res
                            elif isinstance(d, list):
                                for item in d:
                                    res = find_url_in_obj(item)
                                    if res:
                                        return res
                            return None

                        u = find_url_in_obj(photo)
                        if u:
                            media_url = u
                            ext = 'm3u8' if '.m3u8' in u else 'mp4'
            except Exception:
                pass

        # 3. 尝试解析 HTML 及解密 INIT_STATE 数据 (兼容旧版快手结构)
        if not media_url:
            init_m = re.search(r'window\.INIT_STATE\s*=\s*', webpage)
            if init_m:
                try:
                    decoder = json.JSONDecoder()
                    init_data, _ = decoder.raw_decode(webpage[init_m.end():])
                    init_str = json.dumps(init_data)
                    mp4s = re.findall(r'https?://[^\s"\'<>]+\.mp4[^\s"\'<>]*', init_str)
                    if mp4s:
                        media_url = mp4s[0]
                        ext = 'mp4'
                except Exception:
                    pass

        # 4. 容错正则提取网页中所有的 mp4 / m3u8 链接
        if not media_url:
            all_urls = re.findall(r'https?://[^\s"\'<>]+\.(?:mp4|m3u8)[^\s"\'<>]*', webpage)
            if not all_urls:
                all_urls = [u.replace('\\/', '/') for u in re.findall(r'https?:\\/\\/[^\s"\'<>]+\.(?:mp4|m3u8)[^\s"\'<>]*', webpage)]

            clean_urls = []
            for u in all_urls:
                clean_u = u.split('\\')[0].split('"')[0].split("'")[0]
                if url_or_none(clean_u) and clean_u not in clean_urls:
                    clean_urls.append(clean_u)

            if clean_urls:
                for u in clean_urls:
                    if 'kwai' in u or 'kuaishou' in u or 'ndcimgs' in u or 'djvod' in u:
                        media_url = u
                        ext = 'm3u8' if '.m3u8' in u else 'mp4'
                        break
                if not media_url:
                    media_url = clean_urls[0]
                    ext = 'm3u8' if '.m3u8' in media_url else 'mp4'

        # 5. 返回获取到的有效媒体直链
        if media_url:
            return {
                'id': video_id,
                'title': title,
                'url': media_url,
                'ext': ext,
                'http_headers': {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                    'Referer': 'https://www.kuaishou.com/',
                }
            }

        self.raise_no_formats(url, expected=True)
