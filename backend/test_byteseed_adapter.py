"""
字节Seed适配器测试脚本

使用方法：
1. 配置环境变量或直接修改下面的配置
2. 运行: python test_byteseed_adapter.py
"""

import asyncio
import httpx
import sys
import os

# 添加项目路径
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.services.ai.adapters.byteseed import ByteSeedVideoAdapter


# ==================== 配置区 ====================
API_URL = "https://ark.cn-beijing.volces.com/api/v3"
API_KEY = "your-api-key-here"  # 替换为你的API密钥
MODEL = "doubao-seedance-1-5-pro-251215"

# 测试图片（base64格式）
TEST_IMAGE_BASE64 = "data:image/jpeg;base64,/9j/4AAQSkZJRg..."  # 替换为实际的base64图片

# 测试提示词
TEST_PROMPT = "女孩抱着狐狸，女孩睁开眼，温柔地看向镜头，狐狸友善地抱着，镜头缓缓拉出，女孩的头发被风吹动"


# ==================== 测试函数 ====================

async def test_single_image_generation():
    """测试单图生成（首帧模式）"""
    print("\n" + "="*60)
    print("测试1: 单图生成（首帧模式）")
    print("="*60)

    async with httpx.AsyncClient(timeout=120.0) as client:
        adapter = ByteSeedVideoAdapter(
            api_url=API_URL,
            api_key=API_KEY,
            model=MODEL,
            client=client,
            generate_audio=True,
            watermark=False
        )

        print(f"API URL: {API_URL}")
        print(f"Model: {MODEL}")
        print(f"Prompt: {TEST_PROMPT[:50]}...")
        print("\n正在创建视频生成任务...")

        result = await adapter.generate(
            image_url=TEST_IMAGE_BASE64,
            prompt=TEST_PROMPT,
            duration=5,
            resolution="1920x1080"
        )

        print("\n创建任务结果:")
        print(f"  Success: {result.get('success')}")
        print(f"  Status: {result.get('status')}")
        print(f"  Task ID: {result.get('task_id')}")

        if result.get('success'):
            print("\n✅ 单图生成任务创建成功！")
            return result.get('task_id')
        else:
            print(f"\n❌ 单图生成任务创建失败: {result.get('error')}")
            return None


async def test_multi_image_generation():
    """测试首尾帧生成"""
    print("\n" + "="*60)
    print("测试2: 首尾帧生成")
    print("="*60)

    async with httpx.AsyncClient(timeout=120.0) as client:
        adapter = ByteSeedVideoAdapter(
            api_url=API_URL,
            api_key=API_KEY,
            model=MODEL,
            client=client,
            generate_audio=True,
            watermark=False
        )

        print(f"API URL: {API_URL}")
        print(f"Model: {MODEL}")
        print(f"Prompt: {TEST_PROMPT[:50]}...")
        print("\n正在创建首尾帧视频生成任务...")

        result = await adapter.generate_multi_image(
            image_urls=[TEST_IMAGE_BASE64, TEST_IMAGE_BASE64],  # 使用相同图片作为示例
            prompt=TEST_PROMPT,
            duration=5,
            resolution="1920x1080"
        )

        print("\n创建任务结果:")
        print(f"  Success: {result.get('success')}")
        print(f"  Status: {result.get('status')}")
        print(f"  Task ID: {result.get('task_id')}")

        if result.get('success'):
            print("\n✅ 首尾帧生成任务创建成功！")
            return result.get('task_id')
        else:
            print(f"\n❌ 首尾帧生成任务创建失败: {result.get('error')}")
            return None


async def test_poll_task(task_id: str):
    """测试任务状态轮询"""
    print("\n" + "="*60)
    print("测试3: 任务状态轮询")
    print("="*60)

    async with httpx.AsyncClient(timeout=120.0) as client:
        adapter = ByteSeedVideoAdapter(
            api_url=API_URL,
            api_key=API_KEY,
            model=MODEL,
            client=client
        )

        print(f"Task ID: {task_id}")
        print("\n正在查询任务状态...")

        result = await adapter.poll(task_id)

        print("\n查询结果:")
        print(f"  Success: {result.get('success')}")
        print(f"  Status: {result.get('status')}")

        if result.get('status') == 'completed':
            print(f"  Video URL: {result.get('video_url')}")
            print("\n✅ 任务已完成！")
        elif result.get('status') == 'failed':
            print(f"  Error: {result.get('error')}")
            print("\n❌ 任务失败！")
        else:
            print(f"  任务仍在处理中...")
            print("\n⏳ 任务进行中，请稍后再次查询")

        return result


async def test_resolution_mapping():
    """测试分辨率映射"""
    print("\n" + "="*60)
    print("测试4: 分辨率映射")
    print("="*60)

    async with httpx.AsyncClient(timeout=120.0) as client:
        adapter = ByteSeedVideoAdapter(
            api_url=API_URL,
            api_key=API_KEY,
            model=MODEL,
            client=client
        )

        test_cases = [
            ("1920x1080", "16:9"),
            ("1080x1920", "9:16"),
            ("1024x1024", "1:1"),
            ("1440x1080", "4:3"),
            ("1080x1440", "3:4"),
            ("2560x1080", "21:9"),
            ("unknown", "16:9"),  # 默认值
        ]

        print("\n分辨率 -> 比例映射测试:")
        all_passed = True
        for resolution, expected_ratio in test_cases:
            actual_ratio = adapter._map_resolution_to_ratio(resolution)
            status = "✅" if actual_ratio == expected_ratio else "❌"
            print(f"  {status} {resolution:15} -> {actual_ratio:5} (期望: {expected_ratio})")
            if actual_ratio != expected_ratio:
                all_passed = False

        if all_passed:
            print("\n✅ 所有分辨率映射测试通过！")
        else:
            print("\n❌ 部分分辨率映射测试失败！")


async def test_status_mapping():
    """测试状态映射"""
    print("\n" + "="*60)
    print("测试5: 状态映射")
    print("="*60)

    async with httpx.AsyncClient(timeout=120.0) as client:
        adapter = ByteSeedVideoAdapter(
            api_url=API_URL,
            api_key=API_KEY,
            model=MODEL,
            client=client
        )

        test_cases = [
            ("pending", "pending"),
            ("processing", "in_progress"),
            ("running", "in_progress"),
            ("succeeded", "completed"),
            ("completed", "completed"),
            ("failed", "failed"),
            ("error", "failed"),
            ("unknown", "pending"),  # 默认值
        ]

        print("\nByteSeed状态 -> 统一状态映射测试:")
        all_passed = True
        for seed_status, expected_status in test_cases:
            actual_status = adapter._map_status(seed_status)
            status = "✅" if actual_status == expected_status else "❌"
            print(f"  {status} {seed_status:15} -> {actual_status:12} (期望: {expected_status})")
            if actual_status != expected_status:
                all_passed = False

        if all_passed:
            print("\n✅ 所有状态映射测试通过！")
        else:
            print("\n❌ 部分状态映射测试失败！")


async def main():
    """主测试函数"""
    print("\n" + "="*60)
    print("字节Seed视频生成适配器测试")
    print("="*60)

    # 检查配置
    if API_KEY == "your-api-key-here":
        print("\n❌ 错误: 请先配置API_KEY")
        print("请在脚本顶部修改 API_KEY 变量")
        return

    if TEST_IMAGE_BASE64 == "data:image/jpeg;base64,/9j/4AAQSkZJRg...":
        print("\n⚠️  警告: 使用示例图片，请替换为实际的base64图片")
        print("可以跳过实际API调用测试，仅测试映射功能")
        print("\n是否继续？(y/n): ", end="")
        choice = input().strip().lower()
        if choice != 'y':
            return

    try:
        # 测试映射功能（不需要API调用）
        await test_resolution_mapping()
        await test_status_mapping()

        # 测试API调用（需要有效的API密钥和图片）
        if TEST_IMAGE_BASE64 != "data:image/jpeg;base64,/9j/4AAQSkZJRg...":
            # 测试单图生成
            task_id = await test_single_image_generation()

            # 如果创建成功，测试轮询
            if task_id:
                await asyncio.sleep(2)  # 等待2秒
                await test_poll_task(task_id)

            # 测试首尾帧生成
            await test_multi_image_generation()

        print("\n" + "="*60)
        print("测试完成！")
        print("="*60)

    except Exception as e:
        print(f"\n❌ 测试过程中发生错误: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    asyncio.run(main())
