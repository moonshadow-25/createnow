#!/usr/bin/env python3
"""
测试 validation_service 修改后的并发性能
"""

import asyncio
import sys
import os
import time

# 添加backend目录到路径
BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from app.services.validation_service import ValidationService


async def test_validation_concurrency():
    """测试API验证的并发性能"""

    print("="*60)
    print("ValidationService 并发性能测试")
    print("="*60)

    # 测试配置（使用无效的配置，只测试网络并发）
    test_config = {
        "api_url": "https://httpbin.org/delay/1",  # 延迟1秒的测试API
        "api_key": "test_key",
        "model": "test_model"
    }

    async def single_validation(request_id: int):
        """单个验证请求"""
        start = time.time()
        try:
            # 这里会失败（因为不是真实API），但能测试并发性能
            result = await ValidationService.validate_llm_api(
                test_config["api_url"],
                test_config["api_key"],
                test_config["model"]
            )
            duration = time.time() - start
            return {
                'id': request_id,
                'duration': duration,
                'success': True
            }
        except Exception as e:
            duration = time.time() - start
            return {
                'id': request_id,
                'duration': duration,
                'success': False,
                'error': str(e)
            }

    # 测试不同并发数
    test_sizes = [5, 10, 20, 30]

    for num_requests in test_sizes:
        print(f"\n{'='*60}")
        print(f"测试 {num_requests} 个并发验证请求")
        print(f"{'='*60}")

        total_start = time.time()
        tasks = [single_validation(i) for i in range(num_requests)]
        results = await asyncio.gather(*tasks)
        total_duration = time.time() - total_start

        successful = sum(1 for r in results if r['success'])
        failed = num_requests - successful

        durations = [r['duration'] for r in results]
        avg_duration = sum(durations) / len(durations)
        min_duration = min(durations)
        max_duration = max(durations)

        print(f"\n结果:")
        print(f"  总耗时: {total_duration:.3f}秒")
        print(f"  成功: {successful}/{num_requests}")
        print(f"  失败: {failed}/{num_requests}")
        print(f"  请求耗时: 最小={min_duration:.3f}s, 平均={avg_duration:.3f}s, 最大={max_duration:.3f}s")
        print(f"  吞吐量: {num_requests / total_duration:.1f} 请求/秒")

        # 判断并发性能
        if total_duration < num_requests * 0.3:  # 如果总时间远小于串行时间
            print(f"  ✅ 并发性能良好！")
        else:
            print(f"  ⚠️  可能存在并发限制")

        if max_duration > min_duration * 3:
            print(f"  ⚠️  最慢请求是最快的 {max_duration/min_duration:.1f}倍，存在排队现象")

        await asyncio.sleep(1)

    print("\n" + "="*60)
    print("测试完成！")
    print("="*60)
    print("\n预期结果:")
    print("  - 修改前: 吞吐量约 ~6 req/s，存在明显排队")
    print("  - 修改后: 吞吐量应提升至 50+ req/s，无明显排队")


if __name__ == "__main__":
    try:
        asyncio.run(test_validation_concurrency())
    except KeyboardInterrupt:
        print("\n测试被中断")
    except Exception as e:
        print(f"\n测试失败: {e}")
        import traceback
        traceback.print_exc()
