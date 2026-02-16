#!/usr/bin/env python3
"""
测试 HTTP 客户端的并发连接限制

这个脚本会测试：
1. 默认配置下的并发限制
2. 解除限制后的并发性能
3. 不同配置的对比
"""

import asyncio
import httpx
import time
from typing import List
import sys

# 测试服务器地址（使用公共测试API）
TEST_URL = "https://httpbin.org/delay/1"  # 这个API会延迟1秒返回


async def test_concurrent_requests(
    client: httpx.AsyncClient,
    num_requests: int,
    description: str
) -> dict:
    """测试并发请求性能"""
    print(f"\n{'='*60}")
    print(f"测试: {description}")
    print(f"并发请求数: {num_requests}")
    print(f"{'='*60}")

    # 检查客户端配置
    if hasattr(client._transport, '_pool'):
        pool = client._transport._pool
        max_conn = getattr(pool, '_max_connections', 'N/A')
        max_keepalive = getattr(pool, '_max_keepalive_connections', 'N/A')
        print(f"连接池配置: max_connections={max_conn}, max_keepalive={max_keepalive}")

    async def make_request(request_id: int):
        """发送单个请求"""
        start = time.time()
        try:
            response = await client.get(TEST_URL)
            duration = time.time() - start
            return {
                'id': request_id,
                'status': response.status_code,
                'duration': duration,
                'success': True
            }
        except Exception as e:
            duration = time.time() - start
            return {
                'id': request_id,
                'error': str(e),
                'duration': duration,
                'success': False
            }

    # 记录开始时间
    total_start = time.time()

    # 创建所有请求任务
    tasks = [make_request(i) for i in range(num_requests)]

    # 并发执行所有请求
    print(f"\n开始发送 {num_requests} 个并发请求...")
    results = await asyncio.gather(*tasks)

    # 计算总时间
    total_duration = time.time() - total_start

    # 统计结果
    successful = sum(1 for r in results if r['success'])
    failed = num_requests - successful
    avg_duration = sum(r['duration'] for r in results) / num_requests

    print(f"\n结果:")
    print(f"  总耗时: {total_duration:.2f}秒")
    print(f"  成功: {successful}/{num_requests}")
    print(f"  失败: {failed}/{num_requests}")
    print(f"  平均单个请求耗时: {avg_duration:.2f}秒")
    print(f"  理论最佳耗时（完全并发）: ~1秒")
    print(f"  实际并发度: {num_requests / total_duration:.1f} 请求/秒")

    # 判断是否受并发限制
    if total_duration > num_requests * 0.15:  # 如果总时间明显大于理论值
        theoretical_sequential = num_requests * 1.0  # 每个请求1秒
        print(f"\n⚠️  警告: 可能受到并发限制！")
        print(f"  如果完全串行执行需要: {theoretical_sequential:.1f}秒")
        print(f"  如果完全并行执行需要: ~1秒")
        print(f"  实际耗时: {total_duration:.1f}秒")

        # 估算实际并发数
        estimated_concurrency = num_requests / (total_duration - 1)
        print(f"  估算实际并发数: ~{estimated_concurrency:.0f}")
    else:
        print(f"\n✅ 并发性能良好，未受明显限制")

    return {
        'total_duration': total_duration,
        'successful': successful,
        'failed': failed,
        'avg_duration': avg_duration
    }


async def main():
    """主测试函数"""
    print("HTTP 客户端并发连接限制测试")
    print("=" * 60)

    # ==================== 测试1: 默认配置 ====================
    print("\n\n## 测试1: httpx.AsyncClient() - 默认配置")
    async with httpx.AsyncClient(timeout=30.0) as client:
        await test_concurrent_requests(
            client,
            num_requests=15,  # 测试15个请求，看是否受10个限制
            description="默认配置 (应该是100个连接)"
        )

    await asyncio.sleep(2)  # 等待连接清理

    # ==================== 测试2: 故意设置低限制 ====================
    print("\n\n## 测试2: 模拟10个连接限制")
    limits_low = httpx.Limits(
        max_connections=10,
        max_keepalive_connections=5
    )
    async with httpx.AsyncClient(timeout=30.0, limits=limits_low) as client:
        await test_concurrent_requests(
            client,
            num_requests=15,
            description="限制为10个连接（模拟问题场景）"
        )

    await asyncio.sleep(2)

    # ==================== 测试3: 高并发配置 ====================
    print("\n\n## 测试3: 解除限制 - 高并发配置")
    limits_high = httpx.Limits(
        max_connections=2000,
        max_keepalive_connections=500
    )
    async with httpx.AsyncClient(timeout=30.0, limits=limits_high) as client:
        await test_concurrent_requests(
            client,
            num_requests=50,
            description="高并发配置 (2000个连接)"
        )

    await asyncio.sleep(2)

    # ==================== 测试4: HTTP/2 配置 ====================
    print("\n\n## 测试4: 启用 HTTP/2")
    limits_http2 = httpx.Limits(
        max_connections=2000,
        max_keepalive_connections=500
    )
    try:
        async with httpx.AsyncClient(
            timeout=30.0,
            limits=limits_http2,
            http2=True  # 启用 HTTP/2
        ) as client:
            await test_concurrent_requests(
                client,
                num_requests=50,
                description="HTTP/2 + 高并发配置"
            )
    except Exception as e:
        print(f"\n⚠️  HTTP/2 测试失败: {e}")
        print("可能需要安装: pip install httpx[http2]")

    # ==================== 总结 ====================
    print("\n\n" + "="*60)
    print("测试完成！")
    print("="*60)
    print("\n建议:")
    print("1. 如果测试2明显慢于测试1，说明10个连接限制确实存在")
    print("2. 如果测试3和测试4性能更好，说明提高限制有效")
    print("3. 在生产环境中使用测试3或测试4的配置")


if __name__ == "__main__":
    # 运行测试
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n\n测试被用户中断")
    except Exception as e:
        print(f"\n\n测试失败: {e}")
        import traceback
        traceback.print_exc()
