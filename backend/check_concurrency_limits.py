#!/usr/bin/env python3
"""
检查 asyncio 和 uvicorn 的默认并发限制
"""

import asyncio
import sys
import os

# 检查 asyncio 的默认限制
print("="*60)
print("Python asyncio 默认配置检查")
print("="*60)

# 检查事件循环
loop = asyncio.new_event_loop()
print(f"事件循环类型: {type(loop)}")

# 检查是否有默认的并发限制
import concurrent.futures
import multiprocessing

print(f"\nCPU 核心数: {multiprocessing.cpu_count()}")

# ThreadPoolExecutor 默认最大工作线程数
executor = concurrent.futures.ThreadPoolExecutor()
print(f"ThreadPoolExecutor 默认工作线程数: {executor._max_workers}")
executor.shutdown()

# 检查 uvicorn 配置
print("\n" + "="*60)
print("Uvicorn 默认配置")
print("="*60)

try:
    import uvicorn
    from uvicorn.config import Config

    # 创建默认配置
    config = Config("app.main:app")

    print(f"limit_concurrency: {config.limit_concurrency}")
    print(f"backlog: {config.backlog}")
    print(f"timeout_keep_alive: {config.timeout_keep_alive}")
    print(f"limit_max_requests: {config.limit_max_requests}")

except Exception as e:
    print(f"无法检查 uvicorn 配置: {e}")

print("\n" + "="*60)
print("可能的并发限制原因")
print("="*60)
print("""
1. uvicorn 的 limit_concurrency 默认值
2. asyncio 的事件循环限制
3. ThreadPoolExecutor 的线程数限制
4. 某个全局的 Semaphore/Queue
5. 操作系统的文件描述符限制
""")
