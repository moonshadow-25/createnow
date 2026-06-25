# CreateNow Ops Dashboard

独立客户运维控制台，用于集中管理多个 CreateNow 客户实例。

## 功能

- 保存客户实例列表到本机 `ops-dashboard/data/targets.json`
- 批量登录客户实例并读取当前版本、最新版本和更新状态
- 对单个客户实例触发已有 `/api/version/update` 远程更新接口
- 读取并保存客户实例的模型标签与新项目默认模型
- 预览并一次性修改历史项目主模型

## 启动

```bash
cd ops-dashboard
python -m uvicorn app:app --host 127.0.0.1 --port 8518 --reload
```

或在 Windows 上运行：

```bat
start-ops-dashboard.bat
```

打开：`http://127.0.0.1:8518`

## 客户列表格式

页面文本框每行一个客户：

```text
客户名称,公网地址,管理员账号,管理员密码
```

示例：

```text
客户A,https://demo.example.com,menglaoshi,menglaoshi123
客户B,1.2.3.4:8508,menglaoshi,menglaoshi123
```

公网地址可省略协议，工具默认按 `https://` 访问。默认跳过客户实例的 SSL 证书校验，便于自签名证书环境使用。

## 模型配置

模型配置功能全部通过客户实例已有接口完成，不修改主项目代码：

- 读取配置：`GET /api/config`
- 保存模型标签与新项目默认模型：`PUT /api/config/createnow-models`
- 读取项目列表：`GET /api/projects`
- 读取项目详情：`GET /api/projects/{project_id}`
- 修改项目配置：`PUT /api/projects/{project_id}`

保存模型标签与新项目默认模型通常要求客户实例处于 selfhosted 模式，并使用超级管理员 `admin` 登录；普通管理员账号可能返回 403。

“新项目默认模型”只影响之后创建的项目。已有历史项目需要在页面中先预览影响范围，再执行“一次性修改历史项目模型”。执行时工具会逐个读取完整项目，保留原 `ai_config` 的其他字段，并同步服务主模型与当前激活 preset 的模型。

## 安全提示

- 客户账号和密码保存在本机 `ops-dashboard/data/targets.json`，请妥善保管，不要提交到 git。
- 远程更新和模型保存都是写操作，页面会要求二次确认。
- 历史项目模型批量修改会写入客户实例项目元数据，建议先在测试客户或少量项目上验证。
- 本工具只能调用客户实例已有 API，不应直接写客户服务器文件或修改主项目代码。
