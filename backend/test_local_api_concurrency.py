#!/usr/bin/env python3
"""
测试本地 FastAPI 服务的并发处理能力

这个脚本会测试：
1. 本地API的并发请求处理
2. 不同并发数下的性能
3. 找出实际的并发瓶颈
"""

import asyncio
import httpx
import time
import sys
from typing import List

# 本地API地址
LOCAL_API = "http://localhost:8501/api/health"  # 使用健康检查端点测试


async def test_local_api_concurrency(num_requests: int, description: str):
    """测试本地API的并发处理能力"""
    print(f"\n{'='*60}")
    print(f"测试: {description}")
    print(f"并发请求数: {num_requests}")
    print(f"目标API: {LOCAL_API}")
    print(f"{'='*60}")

    async def make_request(request_id: int):
        """发送单个请求到本地API"""
        start = time.time()
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(LOCAL_API)
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

    if successful > 0:
        successful_durations = [r['duration'] for r in results if r['success']]
        avg_duration = sum(successful_durations) / successful
        min_duration = min(successful_durations)
        max_duration = max(successful_durations)
    else:
        avg_duration = 0
        min_duration = 0
        max_duration = 0

    print(f"\n结果:")
    print(f"  总耗时: {total_duration:.3f}秒")
    print(f"  成功: {successful}/{num_requests}")
    print(f"  失败: {failed}/{num_requests}")

    if failed > 0:
        print(f"\n  失败原因:")
        error_types = {}
        for r in results:
            if not r['success']:
                error = r.get('error', 'Unknown')
                error_types[error] = error_types.get(error, 0) + 1
        for error, count in error_types.items():
            print(f"    - {error}: {count}次")

    if successful > 0:
        print(f"\n  请求耗时统计:")
        print(f"    - 平均: {avg_duration:.3f}秒")
        print(f"    - 最小: {min_duration:.3f}秒")
        print(f"    - 最大: {max_duration:.3f}秒")
        print(f"  吞吐量: {successful / total_duration:.1f} 请求/秒")

    # 分析是否有并发限制
    if successful > 0:
        # 如果有请求被明显延迟，可能存在限制
        slow_requests = [r for r in results if r['success'] and r['duration'] > avg_duration * 2]
        if len(slow_requests) > num_requests * 0.2:  # 超过20%的请求明显变慢
            print(f"\n⚠️  检测到 {len(slow_requests)} 个请求明显变慢，可能存在并发限制！")

        # 检查是否有请求堆积（后面的请求明显比前面的慢）
        if max_duration > min_duration * 5:
            print(f"\n⚠️  最慢请求是最快请求的 {max_duration/min_duration:.1f}倍，可能存在排队现象！")
            print(f"     这通常表示服务器端的并发限制")

    return {
        'total_duration': total_duration,
        'successful': successful,
        'failed': failed,
        'throughput': successful / total_duration if total_duration > 0 else 0
    }


async def progressive_load_test():
    """逐步增加负载，找出并发限制"""
    print("\n" + "="*60)
    print("逐步负载测试 - 找出并发瓶颈")
    print("="*60)

    test_sizes = [5, 10, 15, 20, 30, 50]
    results = []

    for size in test_sizes:
        result = await test_local_api_concurrency(
            size,
            f"并发请求数: {size}"
        )
        results.append({
            'size': size,
            'throughput': result['throughput'],
            'failed': result['failed']
        })

        # 如果失败率超过10%，停止测试
        if result['failed'] > size * 0.1:
            print(f"\n⚠️  失败率过高 ({result['failed']}/{size})，停止测试")
            break

        await asyncio.sleep(1)  # 等待服务器恢复

    # 分析结果
    print("\n" + "="*60)
    print("负载测试总结")
    print("="*60)
    print(f"\n{'并发数':<10} {'吞吐量(req/s)':<15} {'失败数':<10} {'状态'}")
    print("-" * 60)

    max_throughput = 0
    optimal_concurrency = 0

    for r in results:
        status = "✅ 良好"
        if r['failed'] > 0:
            status = f"⚠️  有{r['failed']}个失败"

        print(f"{r['size']:<10} {r['throughput']:<15.1f} {r['failed']:<10} {status}")

        if r['throughput'] > max_throughput and r['failed'] == 0:
            max_throughput = r['throughput']
            optimal_concurrency = r['size']

    print(f"\n建议:")
    if optimal_concurrency > 0:
        print(f"  最佳并发数: ~{optimal_concurrency}")
        print(f"  最大吞吐量: {max_throughput:.1f} 请求/秒")

    # 检查是否在某个并发数出现明显的性能下降
    if len(results) >= 2:
        for i in range(1, len(results)):
            prev = results[i-1]
            curr = results[i]
            if curr['throughput'] < prev['throughput'] * 0.7:  # 吞吐量下降超过30%
                print(f"\n⚠️  发现性能瓶颈: 从 {prev['size']} 增加到 {curr['size']} 时，吞吐量下降明显")
                print(f"     {prev['size']} 个并发: {prev['throughput']:.1f} req/s")
                print(f"     {curr['size']} 个并发: {curr['throughput']:.1f} req/s")
                print(f"     可能存在 ~{prev['size']} 个连接的限制")
                break


async def main():
    """主测试函数"""
    print("本地 FastAPI 服务并发测试")
    print("="*60)
    print("\n请确保后端服务正在运行:")
    print("  cd backend && ../env/python.exe app/main.py")
    print("\n按 Enter 开始测试，或 Ctrl+C 取消...")

    try:
        input()
    except KeyboardInterrupt:
        print("\n测试已取消")
        return

    # 先测试连接
    print("\n检查服务是否可用...")
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(LOCAL_API)
            print(f"✅ 服务正常响应: {response.status_code}")
    except Exception as e:
        print(f"❌ 无法连接到服务: {e}")
        print(f"\n请确保后端服务在 http://localhost:8501 运行")
        return

    # 运行逐步负载测试
    await progressive_load_test()

    print("\n" + "="*60)
    print("测试完成！")
    print("="*60)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n\n测试被用户中断")
    except Exception as e:
        print(f"\n\n测试失败: {e}")
        import traceback
        traceback.print_exc()
