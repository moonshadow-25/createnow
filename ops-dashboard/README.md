# CreateNow 客户版本巡检

这是一个独立的运维小工具，不接入主项目页面和路由。第一阶段只读取客户实例状态，不触发更新。

## 启动

在 Windows 中双击：

```bat
ops-dashboard\start-ops-dashboard.bat
```

默认访问：

```text
http://localhost:8518
```

也可以指定端口：

```bat
ops-dashboard\start-ops-dashboard.bat 8520
```

## 输入格式

每行一个客户：

```text
客户名称,公网地址,管理员账号,管理员密码
```

示例：

```text
客户A,https://demo.example.com,menglaoshi,menglaoshi123
客户B,1.2.3.4:8508,menglaoshi,menglaoshi123
```

公网地址可以省略协议，默认按 `https://` 访问。自签名证书默认跳过校验，适配当前客户部署常见情况。

## 保存客户信息

页面会把输入的客户列表保存到本机文件：

```text
ops-dashboard/data/targets.json
```

该文件包含管理员账号密码，请只在可信本机使用，并注意不要外传。

## 当前功能

- 保存和加载客户公网地址、管理员账号密码
- 登录客户实例 `/api/admin/login`
- 读取本地版本 `/api/version`
- 检查远程更新状态 `/api/version/check`
- 展示在线、离线、认证失败、接口异常、是否有新版本

## 当前不做

- 不调用 `/api/version/update`
- 不修改客户机器文件
- 不重启客户服务
- 不调用 `/api/version/update`
- 不修改客户机器文件
- 不重启客户服务
