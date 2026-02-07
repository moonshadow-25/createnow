print("Python is working!")
import sys
print(f"Python version: {sys.version}")
print(f"Python path: {sys.executable}")

try:
    import docx
    print("python-docx is installed")
except ImportError:
    print("python-docx is NOT installed")
