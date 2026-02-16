#!/usr/bin/env python3
"""
实时监控服务器的并发请求数
在后端启动时运行此脚本，然后尝试发送多个请求
"""

import asyncio
import httpx
import time
from datetime import datetime


async def stress_test():
    """压力测试：发送多个并发请求，看看在第几个会卡住"""

    LOCAL_API = "http://localhost:8501/api/health"

    print("="*60)
    print("服务器并发请求压力测试")
    print("="*60)
    print(f"目标: {LOCAL_API}")
    print(f"时间: {datetime.now().strftime('%H:%M:%S')}")
    print("="*60)

    async def make_request(request_id: int):
        """发送单个请求并记录时间"""
        start = time.time()
        status = "等待中..."

        try:
            print(f"[{datetime.now().strftime('%H:%M:%S.%f')[:-3]}] 请求 #{request_id:02d} - 开始发送")

            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.get(LOCAL_API)

            duration = time.time() - start
            status = f"成功 ({response.status_code})"
            print(f"[{datetime.now().strftime('%H:%M:%S.%f')[:-3]}] 请求 #{request_id:02d} - {status}, 耗时 {duration:.3f}秒")

            return {'id': request_id, 'success': True, 'duration': duration}

        except asyncio.TimeoutError:
            duration = time.time() - start
            status = "超时"
            print(f"[{datetime.now().strftime('%H:%M:%S.%f')[:-3]}] 请求 #{request_id:02d} - {status}, 耗时 {duration:.3f}秒")
            return {'id': request_id, 'success': False, 'error': 'timeout', 'duration': duration}

        except Exception as e:
            duration = time.time() - start
            status = f"失败 ({str(e)[:30]})"
            print(f"[{datetime.now().strftime('%H:%M:%S.%f')[:-3]}] 请求 #{request_id:02d} - {status}, 耗时 {duration:.3f}秒")
            return {'id': request_id, 'success': False, 'error': str(e), 'duration': duration}

    # 逐步增加并发数，观察在哪里卡住
    print("\n开始测试...")
    print("观察：如果某些请求长时间没有响应，说明在那里卡住了\n")

    num_requests = 15  # 测试15个请求

    total_start = time.time()
    tasks = [make_request(i + 1) for i in range(num_requests)]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    total_duration = time.time() - total_start

    # 统计结果
    print("\n" + "="*60)
    print("测试完成")
    print("="*60)

    successful = sum(1 for r in results if isinstance(r, dict) and r.get('success'))
    failed = num_requests - successful

    print(f"总耗时: {total_duration:.2f}秒")
    print(f"成功: {successful}/{num_requests}")
    print(f"失败: {failed}/{num_requests}")

    if successful > 0:
        durations = [r['duration'] for r in results if isinstance(r, dict) and r.get('success')]
        print(f"最快响应: {min(durations):.3f}秒")
        print(f"最慢响应: {max(durations):.3f}秒")
        print(f"平均响应: {sum(durations)/len(durations):.3f}秒")

    # 分析是否有明显的分界线
    print("\n分析:")
    if successful < num_requests:
        print(f"⚠️  有 {failed} 个请求失败")
        print("   可能原因：服务器并发限制")

    if successful > 0:
        durations = [r['duration'] for r in results if isinstance(r, dict) and r.get('success')]
        if max(durations) > min(durations) * 5:
            print(f"⚠️  响应时间差异很大（最慢是最快的 {max(durations)/min(durations):.1f}倍）")
            print("   可能原因：请求在排队等待处理")


if __name__ == "__main__":
    try:
        print("\n请确保后端服务正在运行:")
        print("  cd backend && ../env/python.exe app/main.py\n")
        asyncio.run(stress_test())
    except KeyboardInterrupt:
        print("\n\n测试被中断")
    except Exception as e:
        print(f"\n\n测试失败: {e}")
        import traceback
        traceback.print_exc()
