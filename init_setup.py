#!/usr/bin/env python3
"""
CoCo Video Downloader - 一键部署与依赖安装脚本
用途: 检查系统环境，安装 Python 库，自动下载补齐缺少的可执行文件 (yt-dlp, FFmpeg, Deno)
"""

import sys
import shutil
import urllib.request
import zipfile
import os
from pathlib import Path

# 定义下载源链接
YT_DLP_URL = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe"
FFMPEG_URL = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip"
DENO_URL = "https://github.com/denoland/deno/releases/latest/download/deno-x86_64-pc-windows-msvc.zip"

def download_file(url, dest_path):
    """带进度条的下载函数"""
    print(f"  正在下载: {url} \n  保存为: {dest_path.name}")
    
    def reporthook(block_num, block_size, total_size):
        read_so_far = block_num * block_size
        if total_size > 0:
            percent = min(100, read_so_far * 100 // total_size)
            sys.stdout.write(f"\r  下载进度: {percent}% ({read_so_far // 1024 // 1024}MB / {total_size // 1024 // 1024}MB)")
        else:
            sys.stdout.write(f"\r  下载进度: {read_so_far // 1024 // 1024}MB")
        sys.stdout.flush()

    # 设置请求头模拟浏览器，防止被 GitHub 或 CDN 拦截拒绝
    opener = urllib.request.build_opener()
    opener.addheaders = [('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36')]
    urllib.request.install_opener(opener)
    
    urllib.request.urlretrieve(url, str(dest_path), reporthook)
    print("\n  下载完成！")

def download_and_extract_from_zip(url, target_executables, backend_dir):
    """下载 zip 并解压指定的可执行文件到 backend 目录"""
    temp_zip = backend_dir / "temp.zip"
    try:
        download_file(url, temp_zip)
        print("  正在解压并提取目标文件...")
        with zipfile.ZipFile(temp_zip) as z:
            for member in z.namelist():
                member_path = Path(member)
                name = member_path.name
                if name in target_executables:
                    dest_file = backend_dir / name
                    print(f"  [提取] -> {dest_file.name}")
                    with z.open(member) as source, open(dest_file, "wb") as target:
                        shutil.copyfileobj(source, target)
        print("  文件提取完成。")
    except Exception as e:
        print(f"  [ERROR] 下载或解包失败: {e}")
        raise e
    finally:
        if temp_zip.exists():
            temp_zip.unlink()

def main():
    print("=" * 60)
    print("      CoCo Video Downloader 一键环境配置工具 (v1.0)")
    print("=" * 60)
    print()

    # 1. 确保在正确的根目录下运行
    base_dir = Path(__file__).parent.resolve()
    backend_dir = base_dir / "backend"
    requirements_path = backend_dir / "requirements.txt"

    if not backend_dir.exists():
        print(f"[ERROR] 找不到 backend 目录，请在项目根目录下运行此脚本！")
        sys.exit(1)

    # 2. 安装 requirements 中的依赖
    print("[1/4] 正在安装 Python 依赖库 (Flask, Flask-CORS, psutil)...")
    if requirements_path.exists():
        try:
            import subprocess
            subprocess.run(
                [sys.executable, "-m", "pip", "install", "-r", str(requirements_path)],
                check=True
            )
            print("[OK] Python 依赖库安装成功。")
        except Exception as e:
            print(f"[ERROR] Python 依赖安装失败，请手动运行: pip install flask flask-cors psutil")
            sys.exit(1)
    else:
        print("[WARN] 找不到 requirements.txt，跳过 Python 库安装。")
    print()

    # 3. 检测或安装 yt-dlp
    print("[2/4] 检测 yt-dlp 环境...")
    has_global_ytdlp = shutil.which("yt-dlp") or shutil.which("yt-dlp.exe")
    has_local_ytdlp = (backend_dir / "yt-dlp.exe").exists() or (backend_dir / "yt-dlp").exists()

    if has_global_ytdlp:
        print("  [OK] 系统 PATH 中已安装有 yt-dlp。")
    elif has_local_ytdlp:
        print("  [OK] backend 目录中已有本地 yt-dlp 可执行文件。")
    else:
        print("  [WARN] 未检测到 yt-dlp。开始下载本地版 yt-dlp...")
        try:
            download_file(YT_DLP_URL, backend_dir / "yt-dlp.exe")
            print("  [OK] 本地 yt-dlp 部署成功。")
        except Exception as e:
            print(f"  [ERROR] 下载 yt-dlp 失败，请手动下载并放至 backend 目录下: {YT_DLP_URL}")
    print()

    # 4. 检测或安装 FFmpeg
    print("[3/4] 检测 FFmpeg 环境...")
    has_global_ffmpeg = shutil.which("ffmpeg") or shutil.which("ffmpeg.exe")
    has_local_ffmpeg = (backend_dir / "ffmpeg.exe").exists()

    if has_global_ffmpeg:
        print("  [OK] 系统 PATH 中已安装有 FFmpeg。")
    elif has_local_ffmpeg:
        print("  [OK] backend 目录中已有本地 ffmpeg 可执行文件。")
    else:
        print("  [WARN] 未检测到 FFmpeg。开始从 gyan.dev 下载精简版 FFmpeg 软件包...")
        try:
            download_and_extract_from_zip(
                FFMPEG_URL, 
                ["ffmpeg.exe", "ffprobe.exe", "ffplay.exe"], 
                backend_dir
            )
            print("  [OK] 本地 FFmpeg 部署成功。")
        except Exception as e:
            print("  [ERROR] 下载 FFmpeg 失败，您可以稍后手动下载并放至 backend 目录。")
    print()

    # 5. 检测或安装 Deno
    print("[4/4] 检测 Deno 环境...")
    has_global_deno = shutil.which("deno") or shutil.which("deno.exe")
    has_local_deno = (backend_dir / "deno.exe").exists()

    if has_global_deno:
        print("  [OK] 系统 PATH 中已安装有 Deno。")
    elif has_local_deno:
        print("  [OK] backend 目录中已有本地 deno 可执行文件。")
    else:
        print("  [WARN] 未检测到 Deno (推荐，辅助解析 YouTube)。开始下载 Deno...")
        try:
            download_and_extract_from_zip(
                DENO_URL, 
                ["deno.exe"], 
                backend_dir
            )
            print("  [OK] 本地 Deno 部署成功。")
        except Exception as e:
            print("  [ERROR] 下载 Deno 失败，您可以稍后手动下载并放至 backend 目录。")
    print()

    print("=" * 60)
    print("                     [部署程序运行完毕]")
    print("=" * 60)

if __name__ == "__main__":
    main()
