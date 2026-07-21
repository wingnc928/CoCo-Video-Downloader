# CoCo Video Downloader

<p align="center">
  <a href="README.md"><b>简体中文</b></a> | 
  <b>English</b>
</p>

---

> **One-click video / audio downloader for 1000+ websites** — YouTube, TikTok, Kuaishou, Toutiao, Bilibili, Twitter/X, Instagram, Facebook, Reddit, Twitch, Vimeo, and more.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Python 3.8+](https://img.shields.io/badge/python-3.8+-blue.svg)](https://www.python.org/downloads/)
[![yt-dlp](https://img.shields.io/badge/powered%20by-yt--dlp-red.svg)](https://github.com/yt-dlp/yt-dlp)

**CoCo Video Downloader** combines a Manifest V3 browser extension with a local Python Flask backend powered by [yt-dlp](https://github.com/yt-dlp/yt-dlp). Enjoy full CLI downloading capabilities directly from your browser toolbar — no terminal commands required.

![Extension Popup](screenshots/extension-popup.png)

## Key Features

- 🚀 **One-click Video Capture**: Automatically detects active videos on current pages, search overlays, and modals.
- 🌐 **1000+ Websites Supported**: Anything supported by `yt-dlp` (YouTube, TikTok, Twitter, Instagram, Reddit, Bilibili, Twitch, etc.).
- 🧩 **Enhanced Extraction Patches**: Custom extractor patches for Chinese video platforms (Kuaishou SPA, Toutiao DASH streams).
- 🔒 **Duplicate Filename Auto-Renaming**: Prevents overwriting files with identical titles by auto-numbering them (`Title.mp4`, `Title (1).mp4`, `Title (2).mp4`).
- 🍪 **Hot Cookie Synchronization**: Exports browser session cookies automatically to bypass anti-scraping and download high-definition videos.
- 📊 **Real-time Download Metrics**: Percentage, download speed (MB/s), and ETA progress monitoring.
- 📁 **Custom Storage Path**: Configure any output directory on your hard drive via Advanced Settings.
- ⚡ **Windows Startup Auto-Run**: Includes batch scripts for background execution and Windows startup integration.

---

## Screenshots

| Extension Popup | Download Progress | Advanced Settings |
|:---:|:---:|:---:|
| ![Popup](screenshots/extension-popup.png) | ![Progress](screenshots/download-progress.png) | ![Settings](screenshots/extension-settings.png) |

---

## 📦 Installation & Setup

> **Requirements**: Windows 10 / 11 + Python 3.8+ (Python 3.10+ recommended)

### Step 1: Install Python (Skip if installed)
1. Download and install [Python 3.10+](https://www.python.org/downloads/).
2. **Important**: Check **"Add Python to PATH"** during installation.

### Step 2: One-Click Environment Setup
1. Double-click **`Init_Setup.bat`** in the project root directory.
2. Automatically installs Python dependencies (Flask, etc.) and fetches missing binaries (`yt-dlp.exe`, `ffmpeg.exe`, `deno.exe`).

### Step 3: Launch Backend Server (Choose 1)
- **Auto-Start (Recommended)**: Double-click `Add_to_Startup.bat` (runs silently on Windows startup).
- **Silent Start**: Double-click `Start_Background.bat` (runs silently without window).
- **Console Start**: Double-click `Start_Server.bat` (keeps visible CMD window).

### Step 4: Install Browser Extension
1. Open `chrome://extensions/` in Chrome, Edge, or Brave.
2. Enable **"Developer mode"** (top-right toggle).
3. Click **"Load unpacked"** and select the **`extension/`** folder.
4. Pin the extension to your browser toolbar.

---

## 🚀 Usage Guide

1. **Open Page**: Browse to any video page or open a video player modal.
2. **Click Extension**: Click the CoCo Downloader icon in toolbar.
3. **Select Format**: Choose quality (Best Quality / 1080p / 720p / MP3).
4. **Start Download**: Click **"Download Selected Videos"** (files save automatically to your output folder).

---

## 🛠️ Control Scripts Reference

| Script Name | Description |
|---|---|
| **`Init_Setup.bat`** | One-click environment setup (installs Python libraries and fetches `yt-dlp` / `FFmpeg` / `Deno`) |
| **`Start_Server.bat`** | Launch Flask backend server in visible console window |
| **`Start_Background.bat`** | Launch Flask backend server silently in background |
| **`Add_to_Startup.bat`** | Add backend server to Windows startup for zero-friction auto-run |
| **`Remove_from_Startup.bat`** | Remove backend server from Windows startup |
| **`Stop_Server.bat`** | Instantly stop all running backend server processes |
| **`Check_Server.bat`** | Diagnose backend health, Python, and server port connectivity |

---

## ❓ FAQ & Troubleshooting

| Issue | Solution |
|---|---|
| **"Server offline"** | Double-click `Start_Server.bat` or `Add_to_Startup.bat` to launch backend. |
| **"yt-dlp not found"** | Run `Init_Setup.bat` once to auto-download `yt-dlp.exe`. |
| **"Python not found"** | Reinstall Python and **make sure "Add Python to PATH" is checked**. |
| **Duplicate files overwritten?** | Auto-renaming prevents overwriting by naming files `Title.mp4`, `Title (1).mp4`, `Title (2).mp4`. |
| **Search list page doesn't capture video?** | Click any video card on search page to open its **player modal**, then click extension. |
| **Code changes don't take effect?** | Go to `chrome://extensions/` and click the **Reload** icon on CoCo Video Downloader. |

---

## Acknowledgments & Credits

This project would not be possible without the generous contributions of the open-source community. Special thanks to the following outstanding open-source projects:

- 💖 **[yt-dlp](https://github.com/yt-dlp/yt-dlp)**: The flagship media extraction engine that powers this application. Heartfelt thanks to the yt-dlp maintainers and contributors for their amazing work!
- 🎬 **[FFmpeg](https://ffmpeg.org/)**: The cornerstone tool for multimedia processing, video/audio stream merging, and format conversion.
- 🌶️ **[Flask](https://flask.palletsprojects.com/) & [Flask-CORS](https://flask-cors.readthedocs.io/)**: Lightweight, elegant Python web framework providing the stable backend communication channel.
- 🦕 **[Deno](https://deno.com/)**: Fast, modern JavaScript runtime helping accelerate complex stream deciphering for YouTube.
- ⚡ **[psutil](https://github.com/giampaolo/psutil)**: Cross-platform process and system monitoring library.

If you find this project helpful, please consider giving it a **Star 🌟** on GitHub! Your support keeps open-source software growing and thriving!

---

## License

This project is open-source under the [MIT License](LICENSE).
