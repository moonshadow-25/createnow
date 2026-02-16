"""
开发环境启动配置 - 支持热重载，但并发性能较低
"""
import uvicorn
from app.core.config import settings

if __name__ == "__main__":
    print("="*60)
    print("启动模式: 开发环境（热重载）")
    print("="*60)
    print("⚠️  注意：开发模式的并发性能有限")
    print("   - 自动热重载：代码修改后自动重启")
    print("   - 并发限制：约10个左右的并发请求")
    print("   - 建议用途：开发调试")
    print("\n如需测试高并发，请使用: python -m app.main_prod")
    print("="*60 + "\n")

    uvicorn.run(
        "app.main:app",
        host=settings.API_HOST,
        port=settings.API_PORT,
        reload=True,  # 开发模式：启用热重载
        log_level="info"
    )
