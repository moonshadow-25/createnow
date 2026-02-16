#!/usr/bin/env python3
"""
对比测试：修改前后的本地API并发性能

测试方法：
1. 使用不设置limits的client（模拟修改前）
2. 使用设置了limits的client（模拟修改后）
"""

import asyncio
import httpx
import time

LOCAL_API = "http://localhost:8501/api/health"


async def test_without_limits(num_requests: int):
    """测试不设置limits（模拟修改前的validation_service）"""
    print(f"\n{'='*60}")
    print(f"❌ 模拟修改前: 不设置limits - {num_requests}个并发")
    print(f"{'='*60}")

    async def make_request(request_id: int):
        start = time.time()
        try:
            # 每次创建新的client，且不设置limits（模拟修改前）
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(LOCAL_API)
                duration = time.time() - start
                return {'id': request_id, 'duration': duration, 'success': True}
        except Exception as e:
            duration = time.time() - start
            return {'id': request_id, 'duration': duration, 'success': False}

    total_start = time.time()
    tasks = [make_request(i) for i in range(num_requests)]
    results = await asyncio.gather(*tasks)
    total_duration = time.time() - total_start

    successful = sum(1 for r in results if r['success'])
    if successful > 0:
        durations = [r['duration'] for r in results if r['success']]
        avg = sum(durations) / len(durations)
        min_d = min(durations)
        max_d = max(durations)

        print(f"总耗时: {total_duration:.3f}秒")
        print(f"吞吐量: {successful/total_duration:.1f} req/s")
        print(f"耗时: 最小={min_d:.3f}s, 平均={avg:.3f}s, 最大={max_d:.3f}s")
        if max_d > min_d * 3:
            print(f"⚠️  最慢是最快的 {max_d/min_d:.1f}倍 - 存在明显排队")

    return total_duration, successful / total_duration if total_duration > 0 else 0


async def test_with_limits(num_requests: int):
    """测试设置limits（模拟修改后的validation_service）"""
    print(f"\n{'='*60}")
    print(f"✅ 模拟修改后: 设置limits - {num_requests}个并发")
    print(f"{'='*60}")

    async def make_request(request_id: int):
        start = time.time()
        try:
            # 每次创建新的client，但设置了limits（模拟修改后）
            limits = httpx.Limits(max_connections=200, max_keepalive_connections=50)
            async with httpx.AsyncClient(timeout=10.0, limits=limits) as client:
                response = await client.get(LOCAL_API)
                duration = time.time() - start
                return {'id': request_id, 'duration': duration, 'success': True}
        except Exception as e:
            duration = time.time() - start
            return {'id': request_id, 'duration': duration, 'success': False}

    total_start = time.time()
    tasks = [make_request(i) for i in range(num_requests)]
    results = await asyncio.gather(*tasks)
    total_duration = time.time() - total_start

    successful = sum(1 for r in results if r['success'])
    if successful > 0:
        durations = [r['duration'] for r in results if r['success']]
        avg = sum(durations) / len(durations)
        min_d = min(durations)
        max_d = max(durations)

        print(f"总耗时: {total_duration:.3f}秒")
        print(f"吞吐量: {successful/total_duration:.1f} req/s")
        print(f"耗时: 最小={min_d:.3f}s, 平均={avg:.3f}s, 最大={max_d:.3f}s")
        if max_d > min_d * 3:
            print(f"⚠️  最慢是最快的 {max_d/min_d:.1f}倍 - 仍有排队")
        else:
            print(f"✅ 并发良好，无明显排队")

    return total_duration, successful / total_duration if total_duration > 0 else 0


async def main():
    print("="*60)
    print("ValidationService 修改效果对比测试")
    print("="*60)

    # 检查服务
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(LOCAL_API)
            print(f"✅ 本地服务正常: {response.status_code}\n")
    except Exception as e:
        print(f"❌ 无法连接到本地服务: {e}")
        print("请先启动后端: cd backend && ../env/python.exe app/main.py")
        return

    results = []

    for num in [10, 20, 30]:
        print(f"\n{'#'*60}")
        print(f"# 测试 {num} 个并发请求")
        print(f"{'#'*60}")

        # 测试修改前（不设置limits）
        duration_before, throughput_before = await test_without_limits(num)
        await asyncio.sleep(0.5)

        # 测试修改后（设置limits）
        duration_after, throughput_after = await test_with_limits(num)

        # 对比结果
        print(f"\n{'='*60}")
        print(f"对比结果 ({num}个并发):")
        print(f"{'='*60}")
        print(f"修改前: {throughput_before:.1f} req/s")
        print(f"修改后: {throughput_after:.1f} req/s")

        if throughput_after > throughput_before:
            improvement = (throughput_after - throughput_before) / throughput_before * 100
            print(f"✅ 提升: {improvement:.1f}%")
        else:
            print(f"⚠️  未见提升")

        results.append({
            'num': num,
            'before': throughput_before,
            'after': throughput_after
        })

        await asyncio.sleep(1)

    # 总结
    print(f"\n{'='*60}")
    print("总结")
    print(f"{'='*60}")
    print(f"\n{'并发数':<10} {'修改前(req/s)':<15} {'修改后(req/s)':<15} {'提升'}")
    print("-"*60)

    for r in results:
        improvement = (r['after'] - r['before']) / r['before'] * 100 if r['before'] > 0 else 0
        print(f"{r['num']:<10} {r['before']:<15.1f} {r['after']:<15.1f} {improvement:>+6.1f}%")

    avg_improvement = sum((r['after'] - r['before']) / r['before'] * 100 for r in results if r['before'] > 0) / len(results)
    print(f"\n平均提升: {avg_improvement:+.1f}%")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n测试被中断")
    except Exception as e:
        print(f"\n测试失败: {e}")
        import traceback
        traceback.print_exc()
