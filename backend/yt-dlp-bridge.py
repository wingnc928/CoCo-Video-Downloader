#!/usr/bin/env python3
"""CoCo-Video-Downloader Server v1.2 - Browser Extension Backend"""

from flask import Flask, request, jsonify
from flask_cors import CORS
import subprocess
import threading
import os
import sys
import json
import uuid
import shutil
from pathlib import Path
from datetime import datetime
import urllib.parse
import re
import psutil

app = Flask(__name__)
CORS(app)

SETTINGS_FILE = Path(__file__).parent / "settings.json"
DOWNLOADS = {}
cookies_lock = threading.Lock()


def load_settings():
    if SETTINGS_FILE.exists():
        try:
            with open(SETTINGS_FILE, encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {
        "download_dir": str(Path.home() / "Downloads"),
        "format": "best",
        "port": 18080
    }


SETTINGS = load_settings()


def save_settings():
    try:
        with open(SETTINGS_FILE, "w", encoding="utf-8") as f:
            json.dump(SETTINGS, f, indent=2)
    except Exception as e:
        print("[WARN] Failed to save settings:", e)


def find_ytdlp():
    local_candidates = [
        Path(__file__).parent / "yt-dlp.exe",
        Path(__file__).parent / "yt-dlp",
    ]
    for c in local_candidates:
        if c.exists():
            return str(c)

    ytdlp = shutil.which("yt-dlp") or shutil.which("yt-dlp.exe")
    if ytdlp:
        return ytdlp

    candidates = [
        Path.home() / "Downloads" / "yt-dlp.exe",
        Path.home() / "Downloads" / "yt-dlp",
    ]
    for p in sys.path:
        pp = Path(p)
        if pp.name == "Scripts" or "site-packages" in str(pp):
            candidates.append(pp / "yt-dlp.exe")
            candidates.append(pp / "yt-dlp")
    for c in candidates:
        if c.exists():
            return str(c)
    return "yt-dlp"


import re # 确保引入正则模块，用于过滤非法文件名字符

# 注意这里：函数定义现在接收 4 个参数了，最后增加了一个 custom_title=""
def build_cmd(url, fmt, save_dir, custom_title="", job_id=""):
    exe = find_ytdlp()
    current_dir = Path(__file__).parent
    plugins_dir = current_dir / "plugins"
    cookies_file = current_dir / "you.txt"
    if job_id:
        job_cookies = current_dir / f"cookies_{job_id}.txt"
        if job_cookies.exists():
            cookies_file = job_cookies

    # ============================================================
    # 【核心升级】在命令初始化时，硬编码追加 1000+ 网站高兼容容错参数
    # ============================================================
    cmd = [
        exe, url, 
        "--newline", 
        "--no-warnings", 
        "--no-color", 
        "--no-playlist",
        "--no-check-certificates",     # 1. 忽略所有小众、第三方 CDN 证书过期报错
        "--ignore-errors",             # 2. 遇到部分非标准分片失败时，强行跳过继续下载，绝不报死
        "--socket-timeout", "20",      # 3. 设置 20 秒网络连接超时，防止面对顽固流时无限挂起线程
        "--retries", "5"               # 4. 遇到网络波动自动重试 5 次
    ]

    if plugins_dir.exists():
        cmd.extend(["--plugin-dirs", str(plugins_dir)])
        for sub in plugins_dir.iterdir():
            if sub.is_dir() and (sub / "yt_dlp_plugins").exists():
                cmd.extend(["--plugin-dirs", str(sub)])

    # 强行注入主流 Chrome 浏览器的请求头与动态来源页（Referer），防止被识别为无头脚本
    cmd.extend([
        "--user-agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "--referer", url
    ])

    # 增加多线程分片下载参数，应对直链媒体
    cmd.extend(["--concurrent-fragments", "5"])
    
    ffmpeg_exe = current_dir / "ffmpeg.exe"
    if ffmpeg_exe.exists():
        cmd.extend(["--ffmpeg-location", str(ffmpeg_exe)])

# ============================================================
    # 【智能分流防锁防死防连累策略】
    # ============================================================
    # 1. 只有国内像腾讯视频这类死活卡0%、防爬和鉴权极度敏感的硬骨头平台，才动用克隆浏览器数据库的特权参数
    if "qq.com" in url:
        # 针对腾讯视频，这里使用官方针对 Windows 独占锁的钥匙扩展包 brave:+passwd
        cmd.extend(["--cookies-from-browser", "brave:+passwd"])
    
    # 2. 对于B站、YouTube、抖音、头条等原本就不需要死磕物理数据库的站点：
    # 恢复原有的纯净文本传递逻辑即可，彻底免除“Could not copy”由于浏览器没关导致的连带死锁！
    elif cookies_file.exists():
        cmd.extend(["--cookies", str(cookies_file)])
    
    if "youtube.com" in url or "youtu.be" in url:
        deno_exe = current_dir / "deno.exe"
        if deno_exe.exists():
            cmd.extend(["--js-runtimes", f"deno:{str(deno_exe)}"])
            cmd.extend(["--remote-components", "ejs:github"])

    if fmt == "1080p":
        cmd.extend(["-f", "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080]/best"])
    elif fmt == "720p":
        cmd.extend(["-f", "bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720]/best"])
    elif fmt == "mp3":
        cmd.extend(["-x", "--audio-format", "mp3", "--audio-quality", "0"])
    else:
        cmd.extend(["-f", "bestvideo+bestaudio/best"])

    # 强制接管 yt-dlp 的底层物理文件命名！剥夺它抓取乱码的权力
#  修改后的新代码（完美融入唯一指纹：自定义标题 + 平台原生ID）
    if custom_title and custom_title != "-":
        safe_title = re.sub(r'[\\/*?:"<>|]', "", custom_title).strip()
        # 限制标题长度以防 Windows 发生 MAX_PATH 路径超长错误
        safe_title = safe_title[:80].strip()
        if not safe_title:
            safe_title = "下载视频"
    else:
        safe_title = "%(title)s"
        
    # 同名文件检测与自动编号重命名机制：如已存在“标题.mp4”，则自动命名为“标题 (1).mp4”、“标题 (2).mp4”
    if safe_title != "%(title)s":
        base_name = safe_title
        target_title = base_name
        counter = 1
        
        def file_exists(name):
            for ext in [".mp4", ".mkv", ".webm", ".flv", ".avi", ".ts", ".mp3", ".m4a", ".part", ".ytdl"]:
                if os.path.exists(os.path.join(save_dir, f"{name}{ext}")):
                    return True
            return False

        while file_exists(target_title):
            target_title = f"{base_name} ({counter})"
            counter += 1

        out_tpl = os.path.join(save_dir, f"{target_title}.%(ext)s")
    else:
        out_tpl = os.path.join(save_dir, "%(title)s.%(ext)s")
        
    cmd.extend(["-o", out_tpl])
    return cmd


def parse_line(line):
    line = line.strip()
    if not line:
        return None, None, None, None

    pct = None
    speed = None
    eta = None
    title = None

    if "[download]" in line and "%" in line:
        try:
            parts = line.split()
            for p in parts:
                if "%" in p:
                    pct = float(p.replace("%", ""))
                    break
        except Exception:
            pass

    if " at " in line and "/s" in line:
        try:
            at_idx = line.index(" at ")
            rest = line[at_idx + 4:].strip()
            parts2 = rest.split()
            for p in parts2:
                if "/s" in p:
                    speed = p
                    break
        except Exception:
            pass

    if "ETA " in line:
        try:
            eta_idx = line.index("ETA ")
            eta = line[eta_idx + 4:eta_idx + 9].strip()
        except Exception:
            pass

    if "Destination:" in line:
        try:
            dest = line.split("Destination:", 1)[1].strip()
            title = Path(dest).stem
        except Exception:
            pass

    return pct, speed, eta, title


def download_worker(job_id, url, fmt, save_dir, custom_title=""):
    DOWNLOADS[job_id] = {
        "status": "Starting",
        "progress": 0.0,
        "title": custom_title if custom_title else "-",
        "speed": "-",
        "eta": "-",
        "url": url,
        "started": datetime.now().isoformat(),
        "error": None
    }

    if not os.path.isdir(save_dir):
        try:
            os.makedirs(save_dir, exist_ok=True)
        except Exception as e:
            DOWNLOADS[job_id]["status"] = "Error"
            DOWNLOADS[job_id]["error"] = "Cannot create directory: " + str(e)
            return

    try:
        cmd = build_cmd(url, fmt, save_dir, custom_title, job_id)
        print(f"[INFO] Executing command: {' '.join(cmd)}")

        try:
            # 【经验操作】移除 text=True 和 encoding，直接读取最原始的底层字节流 (Bytes)
            proc = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                bufsize=1
            )
            DOWNLOADS[job_id]["status"] = "Downloading"
            DOWNLOADS[job_id]["pid"] = proc.pid

            # 遍历字节流
            for raw_line in proc.stdout:
                # 【动态双盲解码】先尝试标准 UTF-8 解码；若捕获异常，则退回 Windows 默认的 GBK 解码
                try:
                    line = raw_line.decode('utf-8')
                except UnicodeDecodeError:
                    line = raw_line.decode('gbk', errors='ignore')

                if "ERROR:" in line or "WARNING:" in line:
                    print(f"[yt-dlp Backend Output] {line.strip()}")
                    DOWNLOADS[job_id]["error"] = line.strip()

                pct, speed, eta, title = parse_line(line)
                if pct is not None:
                    DOWNLOADS[job_id]["progress"] = pct
                if speed:
                    DOWNLOADS[job_id]["speed"] = speed
                if eta:
                    DOWNLOADS[job_id]["eta"] = eta
                    
                if title and (DOWNLOADS[job_id]["title"] == "-" or not DOWNLOADS[job_id]["title"]):
                    DOWNLOADS[job_id]["title"] = title
                        
                if "has already been downloaded" in line:
                    DOWNLOADS[job_id]["status"] = "Completed"
                    DOWNLOADS[job_id]["progress"] = 100.0

            proc.wait()
            if proc.returncode == 0:
                if DOWNLOADS[job_id]["status"] != "Cancelled":
                    DOWNLOADS[job_id]["status"] = "Completed"
                    DOWNLOADS[job_id]["progress"] = 100.0
                print(f"[SUCCESS] Job {job_id} finished successfully.")
            else:
                if DOWNLOADS[job_id]["status"] != "Cancelled":
                    DOWNLOADS[job_id]["status"] = "Error"
                print(f"[ERROR] Job {job_id} failed with exit code {proc.returncode}")

        except FileNotFoundError:
            DOWNLOADS[job_id]["status"] = "Error"
            DOWNLOADS[job_id]["error"] = "yt-dlp not found. Place yt-dlp.exe in Downloads or this folder."
        except Exception as e:
            DOWNLOADS[job_id]["status"] = "Error"
            DOWNLOADS[job_id]["error"] = str(e)
    finally:
        try:
            job_cookies = Path(__file__).parent / f"cookies_{job_id}.txt"
            if job_cookies.exists():
                job_cookies.unlink()
                print(f"[INFO] Cleaned up temporary cookies file cookies_{job_id}.txt")
        except Exception as e:
            print(f"[WARN] Failed to delete cookies_{job_id}.txt:", e)


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "ytdlp": find_ytdlp()})


@app.route("/download", methods=["POST"])
def start_download():
    data = request.json or {}
    url = data.get("url", "").strip()
    
    # 【日常经验处理】抖音弹窗链接清洗：提取 modal_id 并重组为标准视频链接
    if "douyin.com" in url and "modal_id=" in url:
        match = re.search(r'modal_id=(\d+)', url)
        if match:
            url = f"https://www.douyin.com/video/{match.group(1)}"
            print(f"[INFO] Cleaned Douyin URL to: {url}")

    fmt = data.get("format", SETTINGS.get("format", "best"))
    save_dir = data.get("save_dir", SETTINGS.get("download_dir", str(Path.home() / "Downloads")))
    
    # 接收前端传过来的安全密文，在 Python 内部以严格的 UTF-8 进行解码还原
    raw_title = data.get("title", "").strip()
    custom_title = urllib.parse.unquote(raw_title) if raw_title else ""

    job_id = str(uuid.uuid4())[:8]

    cookie_data = data.get("cookie_data", "").strip()
    if cookie_data:
        try:
            cookies_file = Path(__file__).parent / f"cookies_{job_id}.txt"
            with open(cookies_file, "w", encoding="utf-8") as f:
                f.write(cookie_data)
            print(f"[INFO] Successfully updated cookies_{job_id}.txt with hot cookies from extension.")
        except Exception as e:
            print(f"[WARN] Failed to write cookies_{job_id}.txt:", e)

        try:
            with cookies_lock:
                you_file = Path(__file__).parent / "you.txt"
                with open(you_file, "w", encoding="utf-8") as f:
                    f.write(cookie_data)
            print("[INFO] Successfully updated you.txt with hot cookies from extension.")
        except Exception as e:
            print("[WARN] Failed to write you.txt:", e)

    if not url:
        return jsonify({"error": "No URL provided"}), 400
    if not url.startswith(("http://", "https://")):
        return jsonify({"error": "Invalid URL"}), 400
        
    t = threading.Thread(target=download_worker, args=(job_id, url, fmt, save_dir, custom_title), daemon=True)
    t.start()
    return jsonify({"job_id": job_id, "status": "started"})


@app.route("/progress/<job_id>", methods=["GET"])
def get_progress(job_id):
    return jsonify(DOWNLOADS.get(job_id, {"status": "Unknown"}))


@app.route("/jobs", methods=["GET"])
def get_jobs():
    return jsonify(DOWNLOADS)


@app.route("/settings", methods=["GET"])
def get_settings():
    return jsonify(SETTINGS)


@app.route("/settings", methods=["POST"])
def update_settings():
    global SETTINGS
    data = request.json or {}
    SETTINGS.update(data)
    save_settings()
    return jsonify(SETTINGS)

@app.route("/select_folder", methods=["POST"])
def select_folder():
    try:
        # 使用独立的 python 进程运行 tkinter 文件对话框，避开 Flask 多线程带来的 GUI 主线程限制
        import sys
        
        python_exe = sys.executable
        inline_code = (
            "import tkinter as tk; from tkinter import filedialog; "
            "root=tk.Tk(); root.withdraw(); root.attributes('-topmost', True); "
            "import os; path = filedialog.askdirectory(title='选择视频保存目录'); "
            "print(path.strip() if path else '')"
        )
        
        cmd = [python_exe, "-c", inline_code]
        
        # Windows 下隐藏 CMD 窗口
        startupinfo = None
        if sys.platform == "win32":
            startupinfo = subprocess.STARTUPINFO()
            startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
            
        res = subprocess.run(
            cmd, 
            stdout=subprocess.PIPE, 
            stderr=subprocess.PIPE, 
            text=True, 
            startupinfo=startupinfo, 
            timeout=120
        )
        
        folder_path = res.stdout.strip()
        if folder_path:
            folder_path = os.path.normpath(folder_path)
            return jsonify({"status": "success", "folder": folder_path})
        else:
            return jsonify({"status": "cancelled", "folder": ""})
            
    except Exception as e:
        print("[ERROR] Failed to open folder picker process:", e)
        return jsonify({"status": "error", "error": str(e)}), 500

@app.route("/job_action", methods=["POST"])
def job_action():
    data = request.json or {}
    job_id = data.get("job_id")
    action = data.get("action")
    
    job = DOWNLOADS.get(job_id)
    if not job or not job.get("pid"):
        return jsonify({"error": "Job or PID not found"}), 404
        
    try:
        p = psutil.Process(job["pid"])
        if action == "pause":
            p.suspend()
            job["status"] = "Paused"
        elif action == "resume":
            p.resume()
            job["status"] = "Downloading"
        elif action == "cancel":
            job["status"] = "Cancelled"
            # 级联关闭 yt-dlp 及其拉起的 ffmpeg 子进程
            for child in p.children(recursive=True):
                try: child.kill() 
                except: pass
            p.kill()
        return jsonify({"status": "success", "job_status": job["status"]})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/cancel_all", methods=["POST"])
def cancel_all():
    count = 0
    for job_id, job in DOWNLOADS.items():
        if job["status"] in ["Downloading", "Starting", "Paused"]:
            if job.get("pid"):
                try:
                    p = psutil.Process(job["pid"])
                    job["status"] = "Cancelled"
                    for child in p.children(recursive=True):
                        try: child.kill() 
                        except: pass
                    p.kill()
                    count += 1
                except:
                    pass
    return jsonify({"status": "success", "cancelled_count": count})

if __name__ == "__main__":
    print("=" * 50)
    print("  CoCo-Video-Downloader Server  ")
    print("=" * 50)
    print("  Server:   http://127.0.0.1:" + str(SETTINGS["port"]))
    print("  yt-dlp:   " + find_ytdlp())
    print("  Download: " + SETTINGS["download_dir"])
    print("=" * 50)
    print("  Press Ctrl+C to stop")
    print("=" * 50)
    print()
    try:
        app.run(host="127.0.0.1", port=SETTINGS["port"], threaded=True, debug=False)
    except KeyboardInterrupt:
        print("\n[Server stopped]")