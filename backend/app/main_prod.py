"""
生产环境启动配置 - 高并发性能，不支持热重载
"""
import uvicorn
from app.core.config import settings

if __name__ == "__main__":
    print("="*60)
    print("启动模式: 生产环境（高并发）")
    print("="*60)
    print("✅ 高性能配置：")
    print("   - 并发连接：5000")
    print("   - 等待队列：8192")
    print("   - 热重载：关闭（需手动重启）")
    print("   - 建议用途：生产部署、高并发测试")
    print("="*60 + "\n")

    uvicorn.run(
        "app.main:app",
        host=settings.API_HOST,
        port=settings.API_PORT,
        reload=False,  # 生产模式：关闭热重载
        limit_concurrency=5000,  # 允许5000个并发连接
        backlog=8192,  # 等待队列大小
        timeout_keep_alive=120,  # 保持连接活跃时间
        log_level="info"
    )
