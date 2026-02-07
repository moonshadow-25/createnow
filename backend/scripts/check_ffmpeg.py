import subprocess
import sys

def check_ffmpeg():
    """检查 FFmpeg 是否已安装并可用"""
    try:
        # 检查 ffmpeg
        result = subprocess.run(
            ['ffmpeg', '-version'],
            capture_output=True,
            text=True,
            timeout=5
        )

        if result.returncode == 0:
            version_line = result.stdout.split('\n')[0]
            print(f"✅ FFmpeg installed: {version_line}")
        else:
            print("❌ FFmpeg found but returned error")
            return False

        # 检查 ffprobe
        result = subprocess.run(
            ['ffprobe', '-version'],
            capture_output=True,
            text=True,
            timeout=5
        )

        if result.returncode == 0:
            version_line = result.stdout.split('\n')[0]
            print(f"✅ FFprobe installed: {version_line}")
        else:
            print("⚠️  FFprobe not found (optional)")

        return True

    except FileNotFoundError:
        print("❌ FFmpeg not found in PATH")
        print("\nPlease install FFmpeg:")
        print("  Windows: choco install ffmpeg")
        print("  Mac:     brew install ffmpeg")
        print("  Linux:   sudo apt-get install ffmpeg")
        return False
    except Exception as e:
        print(f"❌ Error checking FFmpeg: {e}")
        return False

if __name__ == "__main__":
    if check_ffmpeg():
        sys.exit(0)
    else:
        sys.exit(1)
