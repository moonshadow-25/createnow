#!/usr/bin/env python3
"""
改进版：使用共享连接池测试本地API并发
"""

import asyncio
import httpx
import time

LOCAL_API = "http://localhost:8501/api/health"


async def test_with_shared_pool(num_requests: int):
    """使用共享连接池测试"""
    print(f"\n{'='*60}")
    print(f"测试: 使用共享连接池 - {num_requests} 个并发请求")
    print(f"{'='*60}")

    # 创建共享的高并发client
    limits = httpx.Limits(
        max_connections=1000,
        max_keepalive_connections=200
    )

    async with httpx.AsyncClient(timeout=10.0, limits=limits) as shared_client:
        # 显示连接池配置
        pool = shared_client._transport._pool
        print(f"连接池配置: max_connections={pool._max_connections}")

        async def make_request(request_id: int):
            start = time.time()
            try:
                response = await shared_client.get(LOCAL_API)  # 使用共享client
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

        total_start = time.time()
        tasks = [make_request(i) for i in range(num_requests)]
        results = await asyncio.gather(*tasks)
        total_duration = time.time() - total_start

        successful = sum(1 for r in results if r['success'])
        failed = num_requests - successful

        if successful > 0:
            durations = [r['duration'] for r in results if r['success']]
            avg_duration = sum(durations) / successful
            min_duration = min(durations)
            max_duration = max(durations)

            print(f"\n结果:")
            print(f"  总耗时: {total_duration:.3f}秒")
            print(f"  成功: {successful}/{num_requests}")
            print(f"  失败: {failed}/{num_requests}")
            print(f"  请求耗时: 最小={min_duration:.3f}s, 平均={avg_duration:.3f}s, 最大={max_duration:.3f}s")
            print(f"  吞吐量: {successful / total_duration:.1f} 请求/秒")

            if max_duration > min_duration * 3:
                print(f"\n⚠️  最慢请求是最快请求的 {max_duration/min_duration:.1f}倍")
                print(f"     估算实际并发处理能力: ~{num_requests/total_duration * min_duration:.0f} 个")


async def main():
    print("本地API并发测试 - 共享连接池版本")
    print("="*60)

    # 检查服务
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(LOCAL_API)
            print(f"✅ 服务正常: {response.status_code}\n")
    except Exception as e:
        print(f"❌ 无法连接: {e}")
        return

    # 逐步测试
    for num in [10, 20, 30, 50, 100]:
        await test_with_shared_pool(num)
        await asyncio.sleep(1)

    print("\n" + "="*60)
    print("测试完成！")
    print("="*60)


if __name__ == "__main__":
    asyncio.run(main())
