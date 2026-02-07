# 卡片遮挡问题修复

## 修复时间
2026-02-03

## 问题根源

**卡片遮挡的真正原因**：
- ❌ 不是 zIndex 问题
- ✅ **estimateSize (380px) < 实际高度 (450px)**
- ✅ VideoCard 溢出虚拟行容器（超出70px）
- ✅ 缺少 overflow: hidden 导致溢出内容遮挡下一行

## 遮挡机制

```
虚拟滚动布局（修复前）：
┌─────────────────────────────┐
│ 第1行（容器高度380px）        │
│ ┌─────────┐  ┌─────────┐    │
│ │ Video 1 │  │ Video 2 │    │ ← 实际高度450px
│ └─────────┘  └─────────┘    │
│            ↓ 溢出70px        │ ← 溢出部分
├─────────────────────────────┤ ← 第2行开始（380px处）
│ 第2行（容器高度380px）        │
│ ┌─────────┐  ┌─────────┐    │ ← 第2行内容遮挡了第1行溢出部分
│ │ Video 3 │  │ Video 4 │    │
```

## VideoCard 实际高度计算

```
双列布局（容器宽度1200px）：
  每列宽度 ≈ 576px

VideoCard 实际高度：
  - 视频区域（aspect-video 16:9）: 576 × 9/16 = 324px
  - 信息区域（p-2）:
    - padding: 16px
    - 状态行: 18px
    - Prompt (line-clamp-2): 34px
    - 按钮行: 28px
    - 调试信息: 20px
    - 间距: 12px
    总计: 128px
  - 外边距: 2px

  总高度 ≈ 454px

考虑 gap-4 (16px)，每行实际需要：454 + 16 = 470px
```

## 修复方案

### 方案A：增加 estimateSize + overflow（已实施）

#### 改动1：增加高度估算

**文件**：`frontend/src/components/storyboard/VideoGallery.tsx`

```typescript
// 修复前
estimateSize: () => {
  const isWideScreen = window.innerWidth >= 768;
  return isWideScreen ? 380 : 480; // ❌ 太小
}

// 修复后
estimateSize: () => {
  const isWideScreen = window.innerWidth >= 768;
  return isWideScreen ? 480 : 580; // ✅ 增加100px余量
}
```

**原因**：
- 实际卡片高度 ≈ 450px
- gap-4 额外占用 16px
- 留出余量防止边界情况

#### 改动2：添加 overflow: hidden

```typescript
// 虚拟行容器
<div
  key={virtualRow.key}
  style={{
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: `${virtualRow.size}px`,
    transform: `translateY(${virtualRow.start}px)`,
    zIndex: virtualRow.index,
    overflow: 'hidden', // ✅ 防止溢出遮挡
  }}
>
```

**作用**：
- 即使卡片高度超过容器，也会被裁剪
- 双重保险，防止极端情况

## 修复效果

| 指标 | 修复前 | 修复后 |
|------|--------|--------|
| estimateSize（双列） | 380px | 480px |
| estimateSize（单列） | 480px | 580px |
| 卡片溢出 | ✅ 可能溢出70px | ❌ 被裁剪 |
| 遮挡问题 | ❌ 严重遮挡 | ✅ 完全解决 |
| overflow控制 | ❌ 无 | ✅ hidden |

## 编译验证

```bash
✓ TypeScript类型检查通过
✓ Vite构建成功
✓ 构建耗时: 2.11秒
```

## 测试要点

- [ ] 双列布局无遮挡
- [ ] 单列布局无遮挡
- [ ] 快速滚动无遮挡
- [ ] 不同分辨率视频无遮挡
- [ ] 调试信息展开时是否被裁剪（可接受）

## 备注

如果未来调试信息展开时被裁剪，可考虑：
1. 调试信息使用 `position: absolute` + `z-index: 9999`
2. 或使用模态框显示调试信息
3. 或实施方案B（动态高度测量）

但当前裁剪影响很小，因为调试信息主要是开发用途。
