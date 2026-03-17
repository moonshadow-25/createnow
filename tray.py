"""
CreateNow 系统托盘程序
双击 tray.bat 启动，无控制台窗口
"""
import os
import subprocess
import threading
import socket
import webbrowser
import time
from pathlib import Path

import pystray
from PIL import Image, ImageDraw, ImageFont

# ==================== 配置 ====================
SCRIPT_DIR = Path(__file__).parent
PYTHON      = SCRIPT_DIR / "env" / "python.exe"
BACKEND_DIR = SCRIPT_DIR / "backend"
SERVER_LOG  = SCRIPT_DIR / "server.log"
TUNNEL_LOG  = SCRIPT_DIR / "tunnel.log"

LOCAL_PORT   = 8001
REMOTE_PORT  = 8001
SERVER_USER  = "root"
SERVER_IP    = "47.117.182.216"
SSH_PORT     = 22
SSH_KEY      = SCRIPT_DIR / "47.117.182.216_id_ed25519"

# ==================== 全局状态 ====================
backend_proc = None
tunnel_proc  = None
tray_icon    = None
_lock        = threading.Lock()

# ==================== 图标绘制 ====================
def _make_icon(color: tuple) -> Image.Image:
    img = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    # 圆角方形背景
    draw.rounded_rectangle([4, 4, 60, 60], radius=14, fill=color)
    # 白色 "C" 字，居中
    font = ImageFont.load_default(size=36)
    bbox = draw.textbbox((0, 0), "C", font=font)
    w, h = bbox[2] - bbox[0], bbox[3] - bbox[1]
    x = (64 - w) // 2 - bbox[0]
    y = (64 - h) // 2 - bbox[1]
    draw.text((x, y), "C", fill=(255, 255, 255, 255), font=font)
    return img

ICON_GREEN  = _make_icon((34, 197, 94, 255))
ICON_YELLOW = _make_icon((234, 179, 8, 255))
ICON_RED    = _make_icon((239, 68, 68, 255))

# ==================== 工具函数 ====================
def _is_port_open(port: int) -> bool:
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=1):
            return True
    except OSError:
        return False

def _open_log(path: Path):
    subprocess.Popen(["notepad", str(path)])

# ==================== 服务管理 ====================
def _start_backend():
    global backend_proc
    with _lock:
        if backend_proc and backend_proc.poll() is None:
            return
        log = open(SERVER_LOG, "a", encoding="utf-8")
        env = {
            **os.environ,
            "PYTHONPATH": str(BACKEND_DIR),
            "API_PORT": str(LOCAL_PORT),
            "PYTHONIOENCODING": "utf-8:replace",
            "PYTHONUTF8": "1",
        }
        backend_proc = subprocess.Popen(
            [str(PYTHON), "app/main.py", "--serve-frontend"],
            cwd=str(BACKEND_DIR),
            stdout=log,
            stderr=log,
            env=env,
            creationflags=subprocess.CREATE_NO_WINDOW,
        )

def _find_ssh() -> str:
    """查找 ssh 可执行文件路径，优先使用 Windows 内置 OpenSSH"""
    import shutil
    candidates = [
        r"C:\Windows\System32\OpenSSH\ssh.exe",
        r"C:\Program Files\Git\usr\bin\ssh.exe",
    ]
    for c in candidates:
        if Path(c).exists():
            return c
    found = shutil.which("ssh")
    if found:
        return found
    return "ssh"  # 回退，让系统自己找

def _start_tunnel():
    global tunnel_proc
    with _lock:
        if tunnel_proc and tunnel_proc.poll() is None:
            return
        if not SSH_KEY.exists():
            with open(TUNNEL_LOG, "a", encoding="utf-8") as log:
                log.write(f"[ERROR] SSH key not found: {SSH_KEY}\n")
            return
        ssh_bin = _find_ssh()
        log = open(TUNNEL_LOG, "a", encoding="utf-8")
        log.write(f"[INFO] Starting tunnel with: {ssh_bin}\n")
        log.flush()
        try:
            tunnel_proc = subprocess.Popen(
                [
                    ssh_bin, "-4", "-N", "-v",
                    "-i", str(SSH_KEY),
                    "-p", str(SSH_PORT),
                    "-o", "ServerAliveInterval=60",
                    "-o", "ServerAliveCountMax=3",
                    "-o", "StrictHostKeyChecking=no",
                    "-o", "ExitOnForwardFailure=yes",
                    "-R", f"{REMOTE_PORT}:127.0.0.1:{LOCAL_PORT}",
                    f"{SERVER_USER}@{SERVER_IP}",
                ],
                stdout=log,
                stderr=log,
                creationflags=subprocess.CREATE_NO_WINDOW,
            )
        except Exception as e:
            log.write(f"[ERROR] Failed to start tunnel: {e}\n")
            log.flush()

def _stop_backend():
    global backend_proc
    with _lock:
        if backend_proc and backend_proc.poll() is None:
            backend_proc.terminate()
            backend_proc.wait()

def _stop_tunnel():
    global tunnel_proc
    with _lock:
        if tunnel_proc and tunnel_proc.poll() is None:
            tunnel_proc.terminate()
            tunnel_proc.wait()

# ==================== 状态监控 ====================
def _update_icon():
    if tray_icon is None:
        return
    backend_ok = _is_port_open(LOCAL_PORT)
    tunnel_ok  = tunnel_proc is not None and tunnel_proc.poll() is None
    if backend_ok and tunnel_ok:
        tray_icon.icon  = ICON_GREEN
        tray_icon.title = "CreateNow - 运行中"
    elif backend_ok:
        tray_icon.icon  = ICON_YELLOW
        tray_icon.title = "CreateNow - 隧道断开"
    elif tunnel_ok:
        tray_icon.icon  = ICON_YELLOW
        tray_icon.title = "CreateNow - 服务启动中"
    else:
        tray_icon.icon  = ICON_RED
        tray_icon.title = "CreateNow - 已停止"

def _monitor_loop():
    # 等后端先启动再连隧道
    time.sleep(5)
    _start_tunnel()

    while True:
        time.sleep(10)
        try:
            # 自动重启异常退出的进程
            if backend_proc is None or backend_proc.poll() is not None:
                _start_backend()
            if tunnel_proc is None or tunnel_proc.poll() is not None:
                _start_tunnel()
            _update_icon()
        except Exception as e:
            # 监控线程不能因单次异常而死亡
            with open(TUNNEL_LOG, "a", encoding="utf-8") as f:
                f.write(f"[ERROR] monitor loop: {e}\n")

# ==================== 菜单回调 ====================
def on_open_browser(icon, item):
    webbrowser.open(f"http://localhost:{LOCAL_PORT}")

def on_view_server_log(icon, item):
    _open_log(SERVER_LOG)

def on_view_tunnel_log(icon, item):
    _open_log(TUNNEL_LOG)

def on_restart_backend(icon, item):
    _stop_backend()
    time.sleep(1)
    _start_backend()

def on_reconnect_tunnel(icon, item):
    _stop_tunnel()
    time.sleep(1)
    _start_tunnel()

def on_quit(icon, item):
    _stop_tunnel()
    _stop_backend()
    icon.stop()

# ==================== 入口 ====================
def main():
    global tray_icon

    # 先启动后端
    _start_backend()

    # 后台监控线程（5秒后自动启隧道）
    threading.Thread(target=_monitor_loop, daemon=True).start()

    menu = pystray.Menu(
        pystray.MenuItem("CreateNow", None, enabled=False),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem("打开浏览器", on_open_browser),
        pystray.MenuItem("查看服务日志", on_view_server_log),
        pystray.MenuItem("查看隧道日志", on_view_tunnel_log),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem("重启本地服务", on_restart_backend),
        pystray.MenuItem("重连 SSH 隧道", on_reconnect_tunnel),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem("退出", on_quit),
    )

    tray_icon = pystray.Icon(
        name="createnow",
        icon=ICON_YELLOW,
        title="CreateNow - 启动中...",
        menu=menu,
    )
    tray_icon.run()


if __name__ == "__main__":
    main()
