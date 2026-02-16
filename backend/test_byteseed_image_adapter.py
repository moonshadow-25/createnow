"""
字节Seed图像生成适配器测试脚本

使用方法：
1. 配置环境变量或直接修改下面的配置
2. 运行: python test_byteseed_image_adapter.py
"""

import asyncio
import httpx
import sys
import os

# 添加项目路径
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.services.ai.adapters.byteseed_image import ByteSeedImageAdapter


# ==================== 配置区 ====================
API_URL = "https://ark.cn-beijing.volces.com/api/v3"
API_KEY = "your-api-key-here"  # 替换为你的API密钥
MODEL = "doubao-seedream-4-5-251128"

# 测试图片（base64格式）
TEST_IMAGE_BASE64 = "data:image/jpeg;base64,/9j/4AAQSkZJRg..."  # 替换为实际的base64图片

# 测试提示词
TEST_TEXT_PROMPT = "生成一组共4张连贯插画，核心为同一庭院一角的四季变迁，以统一风格展现四季独特色彩、元素与氛围"
TEST_IMAGE_PROMPT = "生成3张女孩和奶牛玩偶在游乐园开心地坐过山车的图片，涵盖早晨、中午、晚上"


# ==================== 测试函数 ====================

async def test_text_to_image_single():
    """测试文生图（单图）"""
    print("\n" + "="*60)
    print("测试1: 文生图（单图模式）")
    print("="*60)

    async with httpx.AsyncClient(timeout=120.0) as client:
        adapter = ByteSeedImageAdapter(
            api_url=API_URL,
            api_key=API_KEY,
            model=MODEL,
            client=client,
            max_images=1,
            watermark=False
        )

        print(f"API URL: {API_URL}")
        print(f"Model: {MODEL}")
        print(f"Prompt: {TEST_TEXT_PROMPT[:50]}...")
        print(f"Max Images: 1")
        print("\n正在生成图片...")

        result = await adapter.generate(
            prompt=TEST_TEXT_PROMPT,
            size="1760x2368"
        )

        print("\n生成结果:")
        print(f"  Success: {result.get('success')}")
        if result.get('success'):
            print(f"  Image URL: {result.get('image_url')[:100]}...")
            print(f"  Has Multiple Images: {'images' in result}")
            if 'images' in result:
                print(f"  Total Images: {len(result['images'])}")
            print("\n✅ 文生图（单图）测试成功！")
        else:
            print(f"  Error: {result.get('error')}")
            print("\n❌ 文生图（单图）测试失败！")

        return result


async def test_text_to_image_multi():
    """测试文生图（多图）"""
    print("\n" + "="*60)
    print("测试2: 文生图（多图模式）")
    print("="*60)

    async with httpx.AsyncClient(timeout=120.0) as client:
        adapter = ByteSeedImageAdapter(
            api_url=API_URL,
            api_key=API_KEY,
            model=MODEL,
            client=client,
            max_images=4,
            watermark=False
        )

        print(f"API URL: {API_URL}")
        print(f"Model: {MODEL}")
        print(f"Prompt: {TEST_TEXT_PROMPT[:50]}...")
        print(f"Max Images: 4")
        print("\n正在生成图片...")

        result = await adapter.generate(
            prompt=TEST_TEXT_PROMPT,
            size="1760x2368"
        )

        print("\n生成结果:")
        print(f"  Success: {result.get('success')}")
        if result.get('success'):
            print(f"  Image URL (first): {result.get('image_url')[:100]}...")
            print(f"  Has Multiple Images: {'images' in result}")
            if 'images' in result:
                print(f"  Total Images: {len(result['images'])}")
                for i, img in enumerate(result['images']):
                    print(f"    Image {i+1}: {img['url'][:80]}...")
            print("\n✅ 文生图（多图）测试成功！")
        else:
            print(f"  Error: {result.get('error')}")
            print("\n❌ 文生图（多图）测试失败！")

        return result


async def test_image_to_image_single():
    """测试图生图（单图输入，单图输出）"""
    print("\n" + "="*60)
    print("测试3: 图生图（单图输入，单图输出）")
    print("="*60)

    async with httpx.AsyncClient(timeout=120.0) as client:
        adapter = ByteSeedImageAdapter(
            api_url=API_URL,
            api_key=API_KEY,
            model=MODEL,
            client=client,
            max_images=1,
            watermark=False
        )

        print(f"API URL: {API_URL}")
        print(f"Model: {MODEL}")
        print(f"Prompt: {TEST_IMAGE_PROMPT[:50]}...")
        print(f"Max Images: 1")
        print("\n正在生成图片...")

        result = await adapter.edit(
            image=TEST_IMAGE_BASE64,
            prompt=TEST_IMAGE_PROMPT,
            size="1920x1080"
        )

        print("\n生成结果:")
        print(f"  Success: {result.get('success')}")
        if result.get('success'):
            print(f"  Image URL: {result.get('image_url')[:100]}...")
            print(f"  Has Multiple Images: {'images' in result}")
            print("\n✅ 图生图（单图）测试成功！")
        else:
            print(f"  Error: {result.get('error')}")
            print("\n❌ 图生图（单图）测试失败！")

        return result


async def test_image_to_image_multi():
    """测试图生图（多图输入，多图输出）"""
    print("\n" + "="*60)
    print("测试4: 图生图（多图输入，多图输出）")
    print("="*60)

    async with httpx.AsyncClient(timeout=120.0) as client:
        adapter = ByteSeedImageAdapter(
            api_url=API_URL,
            api_key=API_KEY,
            model=MODEL,
            client=client,
            max_images=3,
            watermark=False
        )

        print(f"API URL: {API_URL}")
        print(f"Model: {MODEL}")
        print(f"Prompt: {TEST_IMAGE_PROMPT[:50]}...")
        print(f"Input Images: 2")
        print(f"Max Output Images: 3")
        print("\n正在生成图片...")

        result = await adapter.edit(
            image=TEST_IMAGE_BASE64,
            prompt=TEST_IMAGE_PROMPT,
            size="1920x1080",
            reference_images=[TEST_IMAGE_BASE64]  # 使用相同图片作为示例
        )

        print("\n生成结果:")
        print(f"  Success: {result.get('success')}")
        if result.get('success'):
            print(f"  Image URL (first): {result.get('image_url')[:100]}...")
            print(f"  Has Multiple Images: {'images' in result}")
            if 'images' in result:
                print(f"  Total Images: {len(result['images'])}")
                for i, img in enumerate(result['images']):
                    print(f"    Image {i+1}: {img['url'][:80]}...")
            print("\n✅ 图生图（多图）测试成功！")
        else:
            print(f"  Error: {result.get('error')}")
            print("\n❌ 图生图（多图）测试失败！")

        return result


async def main():
    """主测试函数"""
    print("\n" + "="*60)
    print("字节Seed图像生成适配器测试")
    print("="*60)

    # 检查配置
    if API_KEY == "your-api-key-here":
        print("\n❌ 错误: 请先配置API_KEY")
        print("请在脚本顶部修改 API_KEY 变量")
        return

    if TEST_IMAGE_BASE64 == "data:image/jpeg;base64,/9j/4AAQSkZJRg...":
        print("\n⚠️  警告: 使用示例图片，请替换为实际的base64图片")
        print("可以跳过图生图测试，仅测试文生图功能")
        print("\n是否继续？(y/n): ", end="")
        choice = input().strip().lower()
        if choice != 'y':
            return

    try:
        # 测试文生图（单图）
        await test_text_to_image_single()

        # 测试文生图（多图）
        await test_text_to_image_multi()

        # 测试图生图（如果有有效的图片）
        if TEST_IMAGE_BASE64 != "data:image/jpeg;base64,/9j/4AAQSkZJRg...":
            await test_image_to_image_single()
            await test_image_to_image_multi()

        print("\n" + "="*60)
        print("测试完成！")
        print("="*60)

    except Exception as e:
        print(f"\n❌ 测试过程中发生错误: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    asyncio.run(main())
