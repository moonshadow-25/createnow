#!/usr/bin/env python3
"""
验证修复效果：测试高并发生图场景

使用方法：
1. 重启后端服务（使用生产模式）:
   cd backend && ../env/python.exe app/main.py

2. 运行此测试脚本:
   cd backend && ../env/python.exe test_fix_verification.py
"""

import asyncio
import httpx
import time
from datetime import datetime


async def verify_fix():
    """验证修复效果"""

    LOCAL_API = "http://localhost:8501/api/health"
    SLOW_API = "https://httpbin.org/delay/30"  # 延迟30秒（模拟生图）

    print("="*60)
    print("验证修复效果 - 高并发生图场景测试")
    print("="*60)
    print(f"时间: {datetime.now().strftime('%H:%M:%S')}")
    print("\n测试场景:")
    print("1. 同时发送20个慢速请求（模拟生图，30秒延迟）")
    print("2. 在慢速请求进行中，每2秒发送1个快速请求")
    print("3. 观察快速请求是否能立即响应")
    print("\n预期结果:")
    print("✅ 修复后：快速请求应该 <0.5秒响应")
    print("❌ 修复前：快速请求会被阻塞 >1秒")
    print("="*60)

    # 共享client
    limits = httpx.Limits(max_connections=2000, max_keepalive_connections=500)
    shared_client = httpx.AsyncClient(timeout=120.0, limits=limits)

    fast_results = []

    async def slow_request(request_id: int):
        """慢速请求（模拟生图）"""
        start = time.time()
        try:
            print(f"[{datetime.now().strftime('%H:%M:%S')}] 🎨 生图请求 #{request_id:02d} - 开始")
            response = await shared_client.get(SLOW_API)
            duration = time.time() - start
            print(f"[{datetime.now().strftime('%H:%M:%S')}] ✅ 生图请求 #{request_id:02d} - 完成 ({duration:.1f}秒)")
            return {'id': request_id, 'success': True, 'duration': duration}
        except Exception as e:
            duration = time.time() - start
            print(f"[{datetime.now().strftime('%H:%M:%S')}] ❌ 生图请求 #{request_id:02d} - 失败: {e}")
            return {'id': request_id, 'success': False, 'duration': duration}

    async def fast_request(request_id: int):
        """快速请求（其他API调用）"""
        start = time.time()
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(LOCAL_API)
            duration = time.time() - start
            status = "✅" if duration < 0.5 else "⚠️"
            print(f"[{datetime.now().strftime('%H:%M:%S')}] {status} API请求 #{request_id:02d} - {duration:.3f}秒")
            return {'id': request_id, 'success': True, 'duration': duration}
        except Exception as e:
            duration = time.time() - start
            print(f"[{datetime.now().strftime('%H:%M:%S')}] ❌ API请求 #{request_id:02d} - 失败 ({duration:.3f}秒)")
            return {'id': request_id, 'success': False, 'duration': duration}

    async def monitor_requests():
        """监控：持续发送快速请求"""
        for i in range(10):  # 发送10个快速请求
            await asyncio.sleep(2)  # 每2秒一个
            result = await fast_request(i + 1)
            fast_results.append(result)

    # 启动测试
    print(f"\n[{datetime.now().strftime('%H:%M:%S')}] 🚀 开始测试...\n")

    # 启动20个慢速请求（模拟20个生图任务）
    slow_tasks = [asyncio.create_task(slow_request(i + 1)) for i in range(20)]

    # 启动监控任务
    monitor_task = asyncio.create_task(monitor_requests())

    # 等待监控完成
    await monitor_task

    # 等待慢速请求完成
    print(f"\n[{datetime.now().strftime('%H:%M:%S')}] ⏳ 等待生图请求完成...\n")
    await asyncio.gather(*slow_tasks)

    # 清理
    await shared_client.aclose()

    # 分析结果
    print("\n" + "="*60)
    print("测试结果")
    print("="*60)

    if fast_results:
        successful = [r for r in fast_results if r['success']]
        if successful:
            durations = [r['duration'] for r in successful]
            avg_duration = sum(durations) / len(durations)
            max_duration = max(durations)
            min_duration = min(durations)

            print(f"\nAPI请求性能（在20个生图任务进行中）:")
            print(f"  总数: {len(successful)}/{len(fast_results)}")
            print(f"  最快: {min_duration:.3f}秒")
            print(f"  最慢: {max_duration:.3f}秒")
            print(f"  平均: {avg_duration:.3f}秒")

            # 判断是否修复成功
            if max_duration < 0.8:
                print(f"\n✅ 修复成功！")
                print(f"   即使有20个生图请求，其他API仍能快速响应")
                print(f"   最慢响应时间: {max_duration:.3f}秒 < 0.8秒")
            elif max_duration < 1.5:
                print(f"\n⚠️  部分改善")
                print(f"   最慢响应时间: {max_duration:.3f}秒")
                print(f"   仍有轻微阻塞，但比修复前好")
            else:
                print(f"\n❌ 问题依然存在")
                print(f"   最慢响应时间: {max_duration:.3f}秒 > 1.5秒")
                print(f"   建议检查:")
                print(f"   1. 是否用生产模式启动（reload=False）")
                print(f"   2. 是否有其他并发限制")

    print("\n" + "="*60)


if __name__ == "__main__":
    print("\n⚠️  请确保后端服务以生产模式运行:")
    print("   cd backend && ../env/python.exe app/main.py")
    print("\n按 Enter 开始测试...")
    try:
        input()
    except:
        pass

    try:
        asyncio.run(verify_fix())
    except KeyboardInterrupt:
        print("\n\n测试被中断")
    except Exception as e:
        print(f"\n\n测试失败: {e}")
        import traceback
        traceback.print_exc()
