#!/usr/bin/env python3
"""
模拟生图场景的并发测试

场景：
1. 发送10个"慢速请求"（模拟生图，延迟60秒）
2. 在慢速请求进行中，发送快速请求
3. 观察快速请求是否被阻塞
"""

import asyncio
import httpx
import time
from datetime import datetime


async def test_blocking_scenario():
    """测试慢速请求是否会阻塞服务器"""

    LOCAL_API = "http://localhost:8501/api/health"
    SLOW_API = "https://httpbin.org/delay/10"  # 延迟10秒的测试API

    print("="*60)
    print("生图场景模拟测试")
    print("="*60)
    print(f"时间: {datetime.now().strftime('%H:%M:%S')}")
    print("\n场景说明:")
    print("1. 发送10个慢速请求（模拟向AI服务器生图，延迟10秒）")
    print("2. 等待2秒后，发送5个快速请求（health check）")
    print("3. 观察快速请求是否被慢速请求阻塞")
    print("="*60)

    # 共享的 httpx client（模拟 ImageGenService 的 client）
    limits = httpx.Limits(max_connections=500, max_keepalive_connections=100)
    shared_client = httpx.AsyncClient(timeout=120.0, limits=limits)

    async def slow_request(request_id: int):
        """模拟生图请求：慢速，需要10秒"""
        start = time.time()
        try:
            print(f"[{datetime.now().strftime('%H:%M:%S')}] 慢速请求 #{request_id:02d} - 开始（模拟生图）")
            response = await shared_client.get(SLOW_API)
            duration = time.time() - start
            print(f"[{datetime.now().strftime('%H:%M:%S')}] 慢速请求 #{request_id:02d} - 完成，耗时 {duration:.1f}秒")
            return {'id': request_id, 'type': 'slow', 'success': True, 'duration': duration}
        except Exception as e:
            duration = time.time() - start
            print(f"[{datetime.now().strftime('%H:%M:%S')}] 慢速请求 #{request_id:02d} - 失败: {e}")
            return {'id': request_id, 'type': 'slow', 'success': False, 'duration': duration}

    async def fast_request(request_id: int):
        """模拟普通请求：快速，应该立即响应"""
        start = time.time()
        try:
            print(f"[{datetime.now().strftime('%H:%M:%S')}] 快速请求 #{request_id:02d} - 开始（health check）")
            # 使用新的 client，模拟其他请求
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(LOCAL_API)
            duration = time.time() - start
            print(f"[{datetime.now().strftime('%H:%M:%S')}] 快速请求 #{request_id:02d} - 完成，耗时 {duration:.3f}秒")
            return {'id': request_id, 'type': 'fast', 'success': True, 'duration': duration}
        except Exception as e:
            duration = time.time() - start
            print(f"[{datetime.now().strftime('%H:%M:%S')}] 快速请求 #{request_id:02d} - 失败: {e}, 耗时 {duration:.3f}秒")
            return {'id': request_id, 'type': 'fast', 'success': False, 'duration': duration}

    # 第一步：启动10个慢速请求（不等待完成）
    print(f"\n[{datetime.now().strftime('%H:%M:%S')}] ⏱️  启动10个慢速请求...\n")
    slow_tasks = [slow_request(i + 1) for i in range(10)]
    slow_futures = [asyncio.create_task(task) for task in slow_tasks]

    # 第二步：等待2秒，让慢速请求先发出
    await asyncio.sleep(2)

    # 第三步：发送快速请求（测试是否被阻塞）
    print(f"\n[{datetime.now().strftime('%H:%M:%S')}] 🚀 慢速请求进行中，现在发送快速请求...\n")
    fast_tasks = [fast_request(i + 1) for i in range(5)]
    fast_results = await asyncio.gather(*fast_tasks)

    # 第四步：等待慢速请求完成
    print(f"\n[{datetime.now().strftime('%H:%M:%S')}] ⏳ 等待慢速请求完成...\n")
    slow_results = await asyncio.gather(*slow_futures)

    # 清理
    await shared_client.aclose()

    # 分析结果
    print("\n" + "="*60)
    print("测试结果分析")
    print("="*60)

    fast_durations = [r['duration'] for r in fast_results if r['success']]
    slow_durations = [r['duration'] for r in slow_results if r['success']]

    print(f"\n慢速请求（模拟生图）:")
    print(f"  成功: {len([r for r in slow_results if r['success']])}/10")
    if slow_durations:
        print(f"  平均耗时: {sum(slow_durations)/len(slow_durations):.1f}秒")

    print(f"\n快速请求（health check）:")
    print(f"  成功: {len([r for r in fast_results if r['success']])}/5")
    if fast_durations:
        print(f"  平均耗时: {sum(fast_durations)/len(fast_durations):.3f}秒")
        max_fast = max(fast_durations)
        print(f"  最慢耗时: {max_fast:.3f}秒")

        # 判断是否被阻塞
        if max_fast > 1.0:  # 如果快速请求超过1秒
            print(f"\n❌ 问题确认：快速请求被慢速请求阻塞！")
            print(f"   health check 应该 <0.5秒，实际最慢 {max_fast:.3f}秒")
            print(f"\n   这证明：当有10个生图请求时，服务器无法处理其他请求")
        else:
            print(f"\n✅ 正常：快速请求未被阻塞，服务器并发处理正常")

    print("\n" + "="*60)


if __name__ == "__main__":
    try:
        print("\n请确保后端服务正在运行:")
        print("  cd backend && ../env/python.exe app/main.py\n")
        asyncio.run(test_blocking_scenario())
    except KeyboardInterrupt:
        print("\n\n测试被中断")
    except Exception as e:
        print(f"\n\n测试失败: {e}")
        import traceback
        traceback.print_exc()
