# 小组智能排班系统

这是一个可直接部署到 GitHub Pages 的静态排班系统。当前项目已经写入 Supabase 公开连接信息，登录 Supabase Auth 账号后可以在多设备之间同步。

## 已完成功能

- 三名员工加一个领导账号
- 21 天循环排班规则，来源于你提供的方案二图片
- 每天自动生成早班、晚班、休息
- 手机端优先适配，适合微信内打开
- 电脑端周排班看板
- 员工查看自己的未来 30 天排班
- 员工提交请假、换班、调休、节假日调整申请
- 领导审批通过或拒绝
- 审批通过后自动生成休息和替班覆盖记录
- 领导手动修改任意员工某一天排班
- 节假日批量调整：全员休息、保留早班、保留晚班、自动平衡、手动调整
- 本周统计：早班、晚班、休息、总工时
- 异常检测：缺早班、缺晚班、人数异常、连续上班提醒
- 本地 JSON 导入导出备份
- Supabase 连接配置和建表 SQL

## 本地打开

直接打开 `index.html` 即可使用。

如果浏览器限制本地文件功能，也可以在当前目录启动一个本地服务：

```bash
python3 -m http.server 8080
```

然后访问：

```text
http://localhost:8080
```

## 账号说明

当前第一版内置 4 个身份，可在右上角切换：

- 领导：可以编辑排班、审批申请、设置节假日
- 张三：员工 A
- 李四：员工 B
- 王五：员工 C

正式给员工使用时，员工看不到“管理”入口；领导账号可以进入管理页完成同步登录、备份和维护。

## Supabase 同步配置

当前已使用的 Supabase 项目：

```text
https://rlwmgtiuhpfqytqbydhm.supabase.co
```

配置步骤：

1. 打开 Supabase SQL Editor。
2. 执行 `supabase-schema.sql`。
3. 在 Supabase Authentication 中创建领导和员工登录账号。
4. 打开系统的“管理”页。
5. 输入 Supabase Auth 登录邮箱和密码。
6. 点击“保存并登录”。
7. 测试修改排班、提交休假、审批同步。

注意：不要把 Supabase `service_role` 或 `secret` key 放到网页里。前端只能使用 publishable key。

## GitHub Pages 部署

建议先确认 Supabase 同步测试通过，再上传 GitHub。

把这些文件放到 GitHub 仓库根目录：

- `index.html`
- `styles.css`
- `app.js`
- `supabase-schema.sql`
- `README.md`

然后在 GitHub 仓库设置里开启 Pages，选择部署根目录即可。

## 后续建议

第一版为了简单稳定，把排班状态存成一个 JSON 状态表。团队只有 3 人时完全够用。  
如果后面人数增加、需要严格区分员工和领导的数据库权限，可以升级为多表结构：

- `profiles`
- `schedule_overrides`
- `leave_requests`
- `holidays`
- `audit_logs`

那时可以把审批权限放到 Supabase RLS 和 RPC 函数里，安全性会更强。
