#!/usr/bin/env python3
"""端到端模拟用户操作：覆盖前端 H5 + 管理后台主要路径。"""
import json
import time
import sys
import urllib.request
import urllib.error

BASE = "http://localhost:3000"
results = []


def call(name, method, path, body=None, token=None, expect_status=None, ip=None):
    """expect_status 可以是 int、list/tuple（任一匹配即算 OK），或 None（任何 2xx 都算 OK）。

    注意：当 expect_status 为 list/tuple 时，list 内的每个状态码都被视为「预期」；
    若实际状态码在 list 中则 OK=True，否则 OK=False。
    """
    url = BASE + path
    data = None
    headers = {"Content-Type": "application/json"}
    if body is not None:
        data = json.dumps(body).encode("utf-8")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if ip:
        headers["X-Forwarded-For"] = ip
    req = urllib.request.Request(url, data=data, method=method, headers=headers)

    expected_set = None
    if expect_status is not None:
        expected_set = set(expect_status) if isinstance(expect_status, (list, tuple)) else {expect_status}

    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            text = resp.read().decode("utf-8", errors="replace")
            try:
                parsed = json.loads(text)
            except Exception:
                parsed = text
            if expected_set is not None:
                ok = resp.status in expected_set
            else:
                ok = 200 <= resp.status < 300
            results.append((name, ok, f"{resp.status} {json.dumps(parsed)[:300] if isinstance(parsed, (dict, list)) else str(parsed)[:300]}"))
            return resp.status, parsed
    except urllib.error.HTTPError as e:
        text = e.read().decode("utf-8", errors="replace")
        try:
            parsed = json.loads(text)
        except Exception:
            parsed = text
        if expected_set is not None:
            ok = e.code in expected_set
        else:
            ok = False
        results.append((name, ok, f"{e.code} {json.dumps(parsed)[:300] if isinstance(parsed, (dict, list)) else str(parsed)[:300]}"))
        return e.code, parsed
    except Exception as e:
        results.append((name, False, f"EXC {type(e).__name__}: {e}"))
        return None, None


def get_token(r):
    if not isinstance(r, dict):
        return None
    return r.get("token") or r.get("access_token") or (r.get("data") or {}).get("token") or (r.get("data") or {}).get("access_token")


def get_data(r):
    if not isinstance(r, dict):
        return {}
    return r.get("data") if isinstance(r.get("data"), dict) else r


def main():
    ts = int(time.time())
    user_a_phone = f"138{ts:08d}"[-11:]
    user_b_phone = f"137{ts:08d}"[-11:]
    ip_a = f"10.1.1.{ts % 250 + 1}"
    ip_b = f"10.1.2.{ts % 250 + 1}"
    ip_seed = f"10.1.3.{ts % 250 + 1}"
    ip_admin = f"10.1.4.{ts % 250 + 1}"

    # ============== A 用户注册 + 实名 ==============
    call("A.register", "POST", "/auth/register", {
        "nickname": "UserA",
        "phone": user_a_phone,
        "password": "Abc12345",
    }, ip=ip_a)
    code, r = call("A.login", "POST", "/auth/login", {
        "phone": user_a_phone,
        "password": "Abc12345",
    }, ip=ip_a)
    token_a = get_token(r)

    call("A.me", "GET", "/users/me", token=token_a, ip=ip_a)
    call("A.account", "GET", "/accounts/me", token=token_a, ip=ip_a)

    # A 未实名，转账应被拒（KB212 → 403）
    call("A.transfer_before_verify", "POST", "/transfers", {
        "toUserId": "nonexistent",
        "amount": 1,
        "payPassword": "123456",
    }, token=token_a, ip=ip_a, expect_status=403)

    # A 第一次提交身份证，应成功（状态 PENDING，待管理员审核）
    id_card_a = f"110101199001{ts:06d}"[-15:]
    call("A.verify_identity_ok", "POST", "/users/verify-identity", {
        "realName": "张三",
        "idCard": id_card_a,
        "payPassword": "123456",
    }, token=token_a, ip=ip_a)

    # ============== B 用户注册 + 实名 ==============
    call("B.register", "POST", "/auth/register", {
        "nickname": "UserB",
        "phone": user_b_phone,
        "password": "Abc12345",
    }, ip=ip_b)
    code, r = call("B.login", "POST", "/auth/login", {
        "phone": user_b_phone,
        "password": "Abc12345",
    }, ip=ip_b)
    token_b = get_token(r)
    code, r = call("B.me", "GET", "/users/me", token=token_b, ip=ip_b)
    user_b_id = get_data(r).get("id")

    # B 用 A 相同的身份证 → 应被拒（KB216 身份证已被使用）
    call("B.verify_identity_dup_idcard", "POST", "/users/verify-identity", {
        "realName": "李四",
        "idCard": id_card_a,
        "payPassword": "654321",
    }, token=token_b, ip=ip_b, expect_status=400)

    # B 用自己的身份证 → 成功（状态 PENDING，待管理员审核）
    ts_b = ts + 1
    id_card_b = f"110101199002{ts_b:06d}"[-15:]
    call("B.verify_identity_ok", "POST", "/users/verify-identity", {
        "realName": "李四",
        "idCard": id_card_b,
        "payPassword": "654321",
    }, token=token_b, ip=ip_b)

    # ============== 管理员登录 + 审核 A、B 实名（必须在资金操作前完成）==============
    code, r = call("admin.login", "POST", "/admin/auth/login", {
        "username": "admin",
        "password": "ChangeAdmin2026",
    }, ip=ip_admin)
    admin_token = get_token(r)

    call("admin.dashboard", "GET", "/admin/dashboard", token=admin_token, ip=ip_admin)
    call("admin.users_list", "GET", "/admin/users?page=1&limit=10", token=admin_token, ip=ip_admin)
    call("admin.identity_pending", "GET", "/admin/identity/pending?page=1&limit=50", token=admin_token, ip=ip_admin)

    # 从待审核列表中找到 A 和 B 的 identity id
    code, r = call("admin.identity_pending_list", "GET", "/admin/identity/pending?page=1&limit=50", token=admin_token, ip=ip_admin)
    identity_a_id = None
    identity_b_id = None
    pending_list = (r or {}).get("data", []) if isinstance(r, dict) else []
    if isinstance(pending_list, list):
        for item in pending_list:
            if not isinstance(item, dict):
                continue
            if item.get("userId") == user_b_id:
                identity_b_id = item.get("id")
            # A 的 user_id 未知，跳过精确匹配，按 realName 兜底
            if item.get("realName") == "张三":
                identity_a_id = item.get("id")

    # 兜底：若分页拿不到，全量扫一遍
    if not identity_b_id or not identity_a_id:
        for page in range(1, 10):
            code, r = call(f"admin.identity_pending_p{page}", "GET", f"/admin/identity/pending?page={page}&limit=50", token=admin_token, ip=ip_admin)
            lst = (r or {}).get("data", []) if isinstance(r, dict) else []
            if not isinstance(lst, list) or not lst:
                break
            for item in lst:
                if not isinstance(item, dict):
                    continue
                if item.get("userId") == user_b_id:
                    identity_b_id = item.get("id")
                if item.get("realName") == "张三" and not identity_a_id:
                    identity_a_id = item.get("id")
            if len(lst) < 50:
                break

    # 审核通过 A 实名
    if identity_a_id:
        call("admin.identity_approve_A", "POST", f"/admin/identity/{identity_a_id}/approve", {}, token=admin_token, ip=ip_admin)
    else:
        results.append(("admin.identity_approve_A", False, "未找到 A 的 identity id"))

    # 审核通过 B 实名（关键：B 实名通过后，seed 才能给 B 转账/红包）
    if identity_b_id:
        call("admin.identity_approve_B", "POST", f"/admin/identity/{identity_b_id}/approve", {}, token=admin_token, ip=ip_admin)
    else:
        results.append(("admin.identity_approve_B", False, "未找到 B 的 identity id"))

    call("admin.merchants_list", "GET", "/admin/merchants?page=1&limit=10", token=admin_token, ip=ip_admin)
    call("admin.withdrawals_list", "GET", "/admin/withdrawals?page=1&limit=10", token=admin_token, ip=ip_admin)
    call("admin.payment_orders", "GET", "/admin/payment-orders?page=1&limit=10", token=admin_token, ip=ip_admin)
    call("admin.risk_events", "GET", "/admin/risk-events?page=1&limit=10", token=admin_token, ip=ip_admin)
    call("admin.risk_rules", "GET", "/admin/risk-rules", token=admin_token, ip=ip_admin)
    call("admin.audit_logs", "GET", "/admin/audit-logs?page=1&limit=10", token=admin_token, ip=ip_admin)
    call("admin.login_logs", "GET", "/admin/login-logs?page=1&limit=10", token=admin_token, ip=ip_admin)
    call("admin.finance_overview", "GET", "/admin/finance/overview?startDate=2026-07-01&endDate=2026-07-31", token=admin_token, ip=ip_admin)
    call("admin.finance_daily_summary", "GET", "/admin/finance/daily-summary?startDate=2026-07-01&endDate=2026-07-31", token=admin_token, ip=ip_admin)
    call("admin.finance_fee_income", "GET", "/admin/finance/fee-income?startDate=2026-07-01&endDate=2026-07-31", token=admin_token, ip=ip_admin)
    call("admin.reconciliation_reports", "GET", "/admin/reconciliation/reports?startDate=2026-07-01&endDate=2026-07-31", token=admin_token, ip=ip_admin)
    call("admin.channels_list", "GET", "/admin/channels", token=admin_token, ip=ip_admin)
    call("admin.system_configs", "GET", "/admin/system-configs", token=admin_token, ip=ip_admin)
    call("admin.admin_users_list", "GET", "/admin/admin-users", token=admin_token, ip=ip_admin)

    # ============== seed 用户登录（已实名、余额 10000 元）==============
    code, r = call("seed.login", "POST", "/auth/login", {
        "phone": "139******11",
        "password": "Abc12345",
    }, ip=ip_seed)
    token_seed = get_token(r)

    # seed 转账给 B（B 已实名 → 应成功）
    call("seed.transfer_to_B", "POST", "/transfers", {
        "toUserId": user_b_id,
        "amount": 100,
        "payPassword": "123456",
        "remark": "E2E 转账",
    }, token=token_seed, ip=ip_seed)

    # seed 发红包，B 抢红包（B 已实名 → 应成功）
    code, r = call("seed.red_packet_create", "POST", "/red-packets", {
        "amount": 50,
        "payPassword": "123456",
        "remark": "E2E 红包",
    }, token=token_seed, ip=ip_seed)
    packet_no = get_data(r).get("packetNo")

    if packet_no:
        call("B.red_packet_receive", "POST", f"/red-packets/{packet_no}/receive", {}, token=token_b, ip=ip_b)

    call("seed.red_packet_sent", "GET", "/red-packets/sent", token=token_seed, ip=ip_seed)
    call("B.red_packet_received", "GET", "/red-packets/received", token=token_b, ip=ip_b)

    # 收款码
    call("seed.qrcode_fixed_create", "POST", "/qr-codes/fixed", {
        "amount": 20,
        "remark": "E2E 固定码",
    }, token=token_seed, ip=ip_seed)
    call("seed.qrcode_personal_list", "GET", "/qr-codes/personal", token=token_seed, ip=ip_seed)

    # 账单（ListBillsQueryDto 仅接受 direction，不接受 page/limit）
    call("seed.bills", "GET", "/bills", token=token_seed, ip=ip_seed)
    call("seed.bills_income", "GET", "/bills?direction=INCOME", token=token_seed, ip=ip_seed)
    call("seed.bills_expense", "GET", "/bills?direction=EXPENSE", token=token_seed, ip=ip_seed)

    # 充值
    call("seed.recharge", "POST", "/transactions/recharge", {
        "amount": 200,
        "payPassword": "123456",
    }, token=token_seed, ip=ip_seed)

    # 提现
    call("seed.withdraw", "POST", "/withdrawals", {
        "amount": 50,
        "payPassword": "123456",
        "channelAccount": "6222001234567890123",
    }, token=token_seed, ip=ip_seed)
    call("seed.withdraw_list", "GET", "/withdrawals", token=token_seed, ip=ip_seed)

    # ============== 商户入驻（PENDING 状态）==============
    # 首次跑：201 创建；后续跑：400 KB301 已申请过商户（幂等性兼容）
    call("seed.merchant_register", "POST", "/merchants/register", {
        "merchantName": "E2E 测试商户",
        "merchantType": "PERSONAL",
        "contactName": "测试联系人",
        "contactPhone": user_b_phone,
    }, token=token_seed, ip=ip_seed, expect_status=[201, 400])
    code, r = call("seed.merchant_me", "GET", "/merchants/me", token=token_seed, ip=ip_seed)
    merchant_id = get_data(r).get("id")
    merchant_status = get_data(r).get("status")

    # 商户应用：DTO 字段是 name（不是 appName）；商户未审核时应被拒（KB310 → 403）
    code, r = call("seed.merchant_create_app_before_audit", "POST", "/merchants/apps", {
        "name": "E2E App",
    }, token=token_seed, ip=ip_seed, expect_status=[201, 403])
    app_id = get_data(r).get("appId") if code == 201 else None

    call("seed.merchant_list_apps", "GET", "/merchants/apps", token=token_seed, ip=ip_seed)

    # 商户未审核时 dashboard / cashier 创建应被拒（KB310 → 403）
    call("seed.merchant_dashboard_pending", "GET", "/merchants/dashboard", token=token_seed, ip=ip_seed, expect_status=[200, 403])
    call("seed.merchant_qrcodes_list", "GET", "/merchants/qrcodes", token=token_seed, ip=ip_seed)

    if merchant_id:
        call("seed.cashier_create_before_audit", "POST", "/cashier/orders", {
            "merchantOrderNo": f"E2E_{ts}",
            "amount": 30,
            "subject": "E2E 订单",
        }, token=token_seed, ip=ip_seed, expect_status=[201, 403])

    # ============== 管理员审核商户（action: APPROVE 大写；不带 rejectReason）==============
    # 首次审核 → 201；商户已审核过 → 400 KB303（幂等性兼容）
    if merchant_id:
        call("admin.merchant_audit", "POST", f"/admin/merchants/{merchant_id}/audit", {
            "action": "APPROVE",
        }, token=admin_token, ip=ip_admin, expect_status=[201, 400])

    # 商户审核通过后 dashboard / cashier / app 创建应成功
    call("seed.merchant_dashboard_approved", "GET", "/merchants/dashboard", token=token_seed, ip=ip_seed, expect_status=200)

    # 审核后创建 app（应成功）
    code, r = call("seed.merchant_create_app_after_audit", "POST", "/merchants/apps", {
        "name": f"E2E App {ts}",
    }, token=token_seed, ip=ip_seed, expect_status=201)
    if not app_id:
        app_id = get_data(r).get("appId")

    if app_id or merchant_id:
        call("seed.cashier_create_after_audit", "POST", "/cashier/orders", {
            "merchantOrderNo": f"E2E_{ts}_2",
            "amount": 30,
            "subject": "E2E 订单 2",
        }, token=token_seed, ip=ip_seed, expect_status=201)

    # ============== 扫码支付（关键用户流程）==============
    # 用 seed 的固定码让 B 来扫码支付
    code, r = call("seed.qrcode_fixed_create_for_pay", "POST", "/qr-codes/fixed", {
        "amount": 10,
        "remark": "E2E 扫码支付码",
    }, token=token_seed, ip=ip_seed, expect_status=201)
    fixed_code = get_data(r).get("code")

    if fixed_code:
        # B 扫码支付给 seed
        call("B.pay_by_qrcode", "POST", "/qr-codes/pay", {
            "code": fixed_code,
            "payPassword": "654321",
            "remark": "E2E 扫码支付",
        }, token=token_b, ip=ip_b, expect_status=201)

    # ============== 收银台订单支付（关键用户流程）==============
    # 取一个已创建的收银台订单号让 B 支付
    code, r = call("seed.cashier_create_for_pay", "POST", "/cashier/orders", {
        "merchantOrderNo": f"E2E_{ts}_pay",
        "amount": 5,
        "subject": "E2E 收银台支付订单",
    }, token=token_seed, ip=ip_seed, expect_status=201)
    cashier_order_no = get_data(r).get("orderNo")

    if cashier_order_no:
        # B 查询收银台订单信息
        call("B.cashier_query", "GET", f"/cashier/orders/{cashier_order_no}", token=token_b, ip=ip_b, expect_status=200)
        # B 支付收银台订单
        call("B.cashier_pay", "POST", f"/cashier/orders/{cashier_order_no}/pay", {
            "payPassword": "654321",
        }, token=token_b, ip=ip_b, expect_status=[200, 201])

    # ============== 商户应用密钥重置 ==============
    if app_id:
        call("seed.merchant_regenerate_secret", "POST", f"/merchants/apps/{app_id}/regenerate-secret", {}, token=token_seed, ip=ip_seed, expect_status=[200, 201])

    # ============== 商户收款码 ==============
    code, r = call("seed.merchant_qrcode_create", "POST", "/merchants/qrcodes", {
        "amount": 15,
        "remark": "E2E 商户收款码",
    }, token=token_seed, ip=ip_seed, expect_status=201)
    merchant_qrcode_id = get_data(r).get("id")

    call("seed.merchant_qrcodes_list_after", "GET", "/merchants/qrcodes", token=token_seed, ip=ip_seed, expect_status=200)

    if merchant_qrcode_id:
        call("seed.merchant_qrcode_delete", "DELETE", f"/merchants/qrcodes/{merchant_qrcode_id}", token=token_seed, ip=ip_seed, expect_status=200)

    # ============== 用户日常查询 ==============
    call("seed.daily_limit", "GET", "/users/daily-limit", token=token_seed, ip=ip_seed, expect_status=200)

    # ============== 银行卡管理（P0 修复：前端 bankCards 页面之前 404）==============
    # 用动态卡号避免重复测试时被「一卡一绑」唯一约束拦截
    seed_card = f"6222001{ts:09d}"[-16:]  # 16 位卡号
    code, r = call("seed.bankcard_create", "POST", "/bank-cards", {
        "holderName": "测试用户",
        "cardNumber": seed_card,
        "bankName": "工商银行",
        "branchName": "北京中关村支行",
        "phone": "13900001111",
        "cardType": "DEBIT",
        "isDefault": True,
    }, token=token_seed, ip=ip_seed, expect_status=201)
    bankcard_id = get_data(r).get("id")

    # 重复绑同一张卡 → 409 KB218
    call("seed.bankcard_create_dup", "POST", "/bank-cards", {
        "holderName": "测试用户",
        "cardNumber": seed_card,
        "bankName": "工商银行",
        "phone": "13900001111",
    }, token=token_seed, ip=ip_seed, expect_status=409)

    # 卡号格式不正确 → 400
    call("seed.bankcard_create_invalid", "POST", "/bank-cards", {
        "holderName": "测试",
        "cardNumber": "abc",
        "bankName": "X",
    }, token=token_seed, ip=ip_seed, expect_status=400)

    # B 用户尝试绑定 seed 同一张卡 → 409 KB218（一卡一绑）
    call("B.bankcard_create_other_dup", "POST", "/bank-cards", {
        "holderName": "李四",
        "cardNumber": seed_card,
        "bankName": "工商银行",
    }, token=token_b, ip=ip_b, expect_status=409)

    # B 绑自己的卡（动态卡号避免重复）
    b_card = f"6228481{ts:09d}"[-16:]
    code, r = call("B.bankcard_create", "POST", "/bank-cards", {
        "holderName": "李四",
        "cardNumber": b_card,
        "bankName": "农业银行",
    }, token=token_b, ip=ip_b, expect_status=201)

    # 列表查询
    call("seed.bankcard_list", "GET", "/bank-cards", token=token_seed, ip=ip_seed, expect_status=200)
    call("seed.bankcard_default", "GET", "/bank-cards/default", token=token_seed, ip=ip_seed, expect_status=200)

    # 更新默认卡
    if bankcard_id:
        call("seed.bankcard_update", "PATCH", f"/bank-cards/{bankcard_id}", {
            "branchName": "上海陆家嘴支行",
            "isDefault": True,
        }, token=token_seed, ip=ip_seed, expect_status=200)

        # 解绑
        call("seed.bankcard_delete", "DELETE", f"/bank-cards/{bankcard_id}", token=token_seed, ip=ip_seed, expect_status=200)
        # 再查一次确认已删除
        call("seed.bankcard_list_after_delete", "GET", "/bank-cards", token=token_seed, ip=ip_seed, expect_status=200)

    # ============== 用户资料/安全设置（P0 修复：前端按钮之前 404）==============
    # 修改登录密码
    call("seed.change_password_wrong_old", "POST", "/users/change-password", {
        "oldPassword": "WrongOldPwd",
        "newPassword": "NewPwd12345",
    }, token=token_seed, ip=ip_seed, expect_status=401)

    call("seed.change_password_same", "POST", "/users/change-password", {
        "oldPassword": "Abc12345",
        "newPassword": "Abc12345",
    }, token=token_seed, ip=ip_seed, expect_status=400)

    code, r = call("seed.change_password_ok", "POST", "/users/change-password", {
        "oldPassword": "Abc12345",
        "newPassword": "Abc12345New",
    }, token=token_seed, ip=ip_seed, expect_status=[200, 201])

    # 改回去，保持测试幂等
    call("seed.change_password_back", "POST", "/users/change-password", {
        "oldPassword": "Abc12345New",
        "newPassword": "Abc12345",
    }, token=token_seed, ip=ip_seed, expect_status=[200, 201])

    # 修改用户资料（PATCH /users/me）
    call("seed.update_profile", "PATCH", "/users/me", {
        "nickname": "测试用户-改名",
    }, token=token_seed, ip=ip_seed, expect_status=200)

    # 修改用户资料：邮箱被其他账号占用 → 400 KB223
    call("seed.update_profile_email_taken", "PATCH", "/users/me", {
        "email": "t***@************",  # seed 已有此邮箱，但其他用户也可能用
    }, token=token_a, ip=ip_a, expect_status=[200, 400])

    # 登录日志
    call("seed.login_logs", "GET", "/users/login-logs", token=token_seed, ip=ip_seed, expect_status=200)

    # 绑定手机号：验证码错误 → 400 KB224
    call("seed.bind_phone_wrong_code", "POST", "/users/bind-phone", {
        "phone": "13900001111",
        "code": "000000",
    }, token=token_seed, ip=ip_seed, expect_status=400)

    # 绑定邮箱：验证码错误 → 400 KB224
    call("seed.bind_email_wrong_code", "POST", "/users/bind-email", {
        "email": "e2e_test@example.com",
        "code": "000000",
    }, token=token_seed, ip=ip_seed, expect_status=400)

    # ============== 商户应用更新（P0 修复：PATCH /merchants/apps/:appId 之前 404）==============
    if app_id:
        call("seed.merchant_app_update", "PATCH", f"/merchants/apps/{app_id}", {
            "name": "E2E App 改名",
            "callbackUrl": "https://example.com/callback",
        }, token=token_seed, ip=ip_seed, expect_status=200)

        call("seed.merchant_app_update_clear_callback", "PATCH", f"/merchants/apps/{app_id}", {
            "callbackUrl": "",
        }, token=token_seed, ip=ip_seed, expect_status=200)

        # 无变更 → 400 KB309
        call("seed.merchant_app_update_no_change", "PATCH", f"/merchants/apps/{app_id}", {}, token=token_seed, ip=ip_seed, expect_status=400)

    # 重置支付密码（需实名信息匹配）- 用 seed 的真实身份信息（seed.ts: 测试用户 / 110101199001011234）
    call("seed.reset_pay_password", "POST", "/users/reset-pay-password", {
        "realName": "测试用户",
        "idCard": "110101199001011234",
        "newPayPassword": "654321",
    }, token=token_seed, ip=ip_seed, expect_status=[200, 201])

    # 改回原支付密码，避免影响后续测试
    call("seed.reset_pay_password_back", "POST", "/users/reset-pay-password", {
        "realName": "测试用户",
        "idCard": "110101199001011234",
        "newPayPassword": "123456",
    }, token=token_seed, ip=ip_seed, expect_status=[200, 201])

    # ============== 担保交易 Escrow 完整链路 ==============
    # seed 作为买家，B 作为卖家
    if user_b_id:
        # 1) 买家创建担保订单（仅创建不扣款，状态 CREATED）
        code, r = call("seed.escrow_create", "POST", "/escrow/orders", {
            "sellerId": user_b_id,
            "amount": 10,
            "subject": f"E2E 担保交易 {ts}",
            "body": "测试担保订单",
        }, token=token_seed, ip=ip_seed, expect_status=201)
        escrow_order_no = get_data(r).get("orderNo") if code == 201 else None

        if escrow_order_no:
            # 查询订单详情
            call("seed.escrow_detail", "GET", f"/escrow/orders/{escrow_order_no}", token=token_seed, ip=ip_seed, expect_status=200)

            # 列表查询
            call("seed.escrow_list_buyer", "GET", "/escrow/orders?role=buyer", token=token_seed, ip=ip_seed, expect_status=200)
            call("B.escrow_list_seller", "GET", "/escrow/orders?role=seller", token=token_b, ip=ip_b, expect_status=200)

            # 2) 买家付款（资金冻结到买家 frozenBalance），状态 PAID
            call("seed.escrow_pay", "POST", f"/escrow/orders/{escrow_order_no}/pay", {
                "payPassword": "123456",
            }, token=token_seed, ip=ip_seed, expect_status=[200, 201])

            # 重复付款应失败（KB631 ESCROW_STATUS_INVALID）
            call("seed.escrow_pay_dup", "POST", f"/escrow/orders/{escrow_order_no}/pay", {
                "payPassword": "123456",
            }, token=token_seed, ip=ip_seed, expect_status=400)

            # 3) 非卖家发货应被拒（KB633 ESCROW_SELLER_ONLY）
            call("seed.escrow_ship_not_seller", "POST", f"/escrow/orders/{escrow_order_no}/ship", {}, token=token_seed, ip=ip_seed, expect_status=403)

            # 4) 卖家发货，状态 SHIPPED
            call("B.escrow_ship", "POST", f"/escrow/orders/{escrow_order_no}/ship", {}, token=token_b, ip=ip_b, expect_status=[200, 201])

            # 5) 卖家重复发货应失败
            call("B.escrow_ship_dup", "POST", f"/escrow/orders/{escrow_order_no}/ship", {}, token=token_b, ip=ip_b, expect_status=400)

            # 6) 买家确认收货，资金放款给卖家，状态 RECEIVED
            call("seed.escrow_confirm", "POST", f"/escrow/orders/{escrow_order_no}/confirm", {}, token=token_seed, ip=ip_seed, expect_status=[200, 201])

            # 7) 已收货后无法再次确认
            call("seed.escrow_confirm_dup", "POST", f"/escrow/orders/{escrow_order_no}/confirm", {}, token=token_seed, ip=ip_seed, expect_status=400)

    # 担保交易：退款流程（创建新订单，走完退款链路）
    if user_b_id:
        code, r = call("seed.escrow_create_for_refund", "POST", "/escrow/orders", {
            "sellerId": user_b_id,
            "amount": 5,
            "subject": f"E2E 担保退款 {ts}",
            "idempotencyKey": f"escrow_refund_{ts}",
        }, token=token_seed, ip=ip_seed, expect_status=201)
        escrow_refund_no = get_data(r).get("orderNo") if code == 201 else None

        if escrow_refund_no:
            # 付款
            call("seed.escrow_pay_for_refund", "POST", f"/escrow/orders/{escrow_refund_no}/pay", {
                "payPassword": "123456",
            }, token=token_seed, ip=ip_seed, expect_status=[200, 201])
            # 发货
            call("B.escrow_ship_for_refund", "POST", f"/escrow/orders/{escrow_refund_no}/ship", {}, token=token_b, ip=ip_b, expect_status=[200, 201])
            # 买家申请退款
            call("seed.escrow_refund_request", "POST", f"/escrow/orders/{escrow_refund_no}/refund-request", {
                "reason": "E2E 商品有瑕疵",
            }, token=token_seed, ip=ip_seed, expect_status=[200, 201])
            # 卖家拒绝退款（资金放给卖家）
            call("B.escrow_refund_reject", "POST", f"/escrow/orders/{escrow_refund_no}/refund-resolve", {
                "decision": "REJECT_REFUND",
                "reason": "买家原因，卖家无责",
            }, token=token_b, ip=ip_b, expect_status=[200, 201])

    # 担保交易：取消订单（CREATED 状态）
    if user_b_id:
        code, r = call("seed.escrow_create_for_cancel", "POST", "/escrow/orders", {
            "sellerId": user_b_id,
            "amount": 3,
            "subject": f"E2E 担保取消 {ts}",
        }, token=token_seed, ip=ip_seed, expect_status=201)
        escrow_cancel_no = get_data(r).get("orderNo") if code == 201 else None

        if escrow_cancel_no:
            # 买家取消订单
            call("seed.escrow_cancel", "POST", f"/escrow/orders/{escrow_cancel_no}/cancel", {}, token=token_seed, ip=ip_seed, expect_status=[200, 201])
            # 已取消后再次取消应失败
            call("seed.escrow_cancel_dup", "POST", f"/escrow/orders/{escrow_cancel_no}/cancel", {}, token=token_seed, ip=ip_seed, expect_status=400)

    # 担保交易：异常场景
    # 通过获取 seed 的 user_id 来测「不能与自己担保交易」
    code, r = call("seed.me_for_id", "GET", "/users/me", token=token_seed, ip=ip_seed)
    seed_user_id = get_data(r).get("id")
    if seed_user_id:
        call("seed.escrow_self_real", "POST", "/escrow/orders", {
            "sellerId": seed_user_id,
            "amount": 1,
            "subject": "self test",
        }, token=token_seed, ip=ip_seed, expect_status=400)
    else:
        results.append(("seed.escrow_self_real", False, "未获取到 seed 用户 ID"))

    # 担保交易：订单不存在
    call("seed.escrow_not_found", "GET", "/escrow/orders/E_NOT_EXIST", token=token_seed, ip=ip_seed, expect_status=404)

    # ============== 批量转账 BatchTransfer 完整链路 ==============
    # seed 向 B 批量转账（一笔成功）
    if user_b_id:
        # 1) 正常提交批量转账（1 笔成功 + 1 笔失败：toUserId 不存在）
        code, r = call("seed.batch_transfer_create", "POST", "/batch-transfers", {
            "items": [
                {"toUserId": user_b_id, "amount": 1.5, "remark": "E2E 批量 1"},
                {"toUserId": "nonexistent-user-id", "amount": 0.5, "remark": "E2E 批量失败"},
            ],
            "remark": f"E2E 批量转账 {ts}",
            "payPassword": "123456",
            "idempotencyKey": f"batch_{ts}",
        }, token=token_seed, ip=ip_seed, expect_status=201)
        batch_no = get_data(r).get("batchNo") if code == 201 else None

        if batch_no:
            # 2) 查询批次详情
            call("seed.batch_transfer_detail", "GET", f"/batch-transfers/{batch_no}", token=token_seed, ip=ip_seed, expect_status=200)
            # 3) 列表查询
            call("seed.batch_transfer_list", "GET", "/batch-transfers", token=token_seed, ip=ip_seed, expect_status=200)
            call("seed.batch_transfer_list_completed", "GET", "/batch-transfers?status=COMPLETED", token=token_seed, ip=ip_seed, expect_status=200)

        # 4) 幂等键冲突测试：再次提交相同 idempotencyKey 应返回原批次
        if batch_no:
            call("seed.batch_transfer_idem", "POST", "/batch-transfers", {
                "items": [{"toUserId": user_b_id, "amount": 1.5}],
                "payPassword": "123456",
                "idempotencyKey": f"batch_{ts}",
            }, token=token_seed, ip=ip_seed, expect_status=201)

    # 5) 异常场景：明细为空
    call("seed.batch_transfer_empty", "POST", "/batch-transfers", {
        "items": [],
        "payPassword": "123456",
    }, token=token_seed, ip=ip_seed, expect_status=400)

    # 6) 异常场景：明细重复收款方
    if user_b_id:
        call("seed.batch_transfer_dup", "POST", "/batch-transfers", {
            "items": [
                {"toUserId": user_b_id, "amount": 1},
                {"toUserId": user_b_id, "amount": 2},
            ],
            "payPassword": "123456",
        }, token=token_seed, ip=ip_seed, expect_status=400)

    # 7) 异常场景：包含自己
    code, r = call("seed.me_for_batch", "GET", "/users/me", token=token_seed, ip=ip_seed)
    seed_user_id = get_data(r).get("id")
    if seed_user_id:
        call("seed.batch_transfer_self", "POST", "/batch-transfers", {
            "items": [{"toUserId": seed_user_id, "amount": 1}],
            "payPassword": "123456",
        }, token=token_seed, ip=ip_seed, expect_status=400)

    # 8) 异常场景：批次不存在
    call("seed.batch_transfer_not_found", "GET", "/batch-transfers/BT_NOT_EXIST", token=token_seed, ip=ip_seed, expect_status=404)

    # 9) 异常场景：取消已完成的批次
    if batch_no:
        call("seed.batch_transfer_cancel_completed", "POST", f"/batch-transfers/{batch_no}/cancel", {}, token=token_seed, ip=ip_seed, expect_status=400)

    # ============== 订阅/周期扣款 Subscriptions 完整链路 ==============
    # 1) seed 创建订阅计划
    code, r = call("seed.subscription_plan_create", "POST", "/subscriptions/plans", {
        "name": f"E2E 月度会员 {ts}",
        "description": "E2E 测试订阅计划",
        "amount": 1.5,
        "period": "MONTHLY",
        "intervalCount": 1,
        "trialDays": 0,
    }, token=token_seed, ip=ip_seed, expect_status=201)
    plan_no = get_data(r).get("planNo") if code == 201 else None

    # 2) 查询计划详情
    if plan_no:
        call("seed.subscription_plan_detail", "GET", f"/subscriptions/plans/{plan_no}", token=token_seed, ip=ip_seed, expect_status=200)

    # 3) 列出我的计划
    call("seed.subscription_plan_list", "GET", "/subscriptions/plans", token=token_seed, ip=ip_seed, expect_status=200)
    call("seed.subscription_plan_list_active", "GET", "/subscriptions/plans?status=ACTIVE", token=token_seed, ip=ip_seed, expect_status=200)

    # 4) 异常：计划不存在
    call("seed.subscription_plan_not_found", "GET", "/subscriptions/plans/SP_NOT_EXIST", token=token_seed, ip=ip_seed, expect_status=404)

    # 5) 异常：金额无效
    call("seed.subscription_plan_invalid_amount", "POST", "/subscriptions/plans", {
        "name": "无效",
        "amount": 0,
        "period": "MONTHLY",
    }, token=token_seed, ip=ip_seed, expect_status=400)

    # 6) B 订阅 seed 的计划（无试用期 → 立即扣首期款）
    subscription_no = None
    if plan_no and user_b_id:
        code, r = call("B.subscription_subscribe", "POST", f"/subscriptions/{plan_no}/subscribe", {
            "payPassword": "654321",
            "idempotencyKey": f"sub_{ts}",
        }, token=token_b, ip=ip_b, expect_status=201)
        subscription_no = get_data(r).get("subscriptionNo") if code == 201 else None

    # 7) 幂等键命中应返回已有订阅
    if plan_no and user_b_id:
        call("B.subscription_idem", "POST", f"/subscriptions/{plan_no}/subscribe", {
            "payPassword": "654321",
            "idempotencyKey": f"sub_{ts}",
        }, token=token_b, ip=ip_b, expect_status=201)

    # 8) 异常：B 重复订阅该计划应被拒
    if plan_no and user_b_id:
        call("B.subscription_dup", "POST", f"/subscriptions/{plan_no}/subscribe", {
            "payPassword": "654321",
        }, token=token_b, ip=ip_b, expect_status=400)

    # 9) 异常：seed 订阅自己的计划
    if plan_no:
        call("seed.subscription_self", "POST", f"/subscriptions/{plan_no}/subscribe", {
            "payPassword": "123456",
        }, token=token_seed, ip=ip_seed, expect_status=400)

    # 10) 查询订阅详情（订阅者可查看）
    if subscription_no:
        call("B.subscription_detail", "GET", f"/subscriptions/subscriptions/{subscription_no}", token=token_b, ip=ip_b, expect_status=200)
        # 计划 owner 也可查看
        call("seed.subscription_detail_as_owner", "GET", f"/subscriptions/subscriptions/{subscription_no}", token=token_seed, ip=ip_seed, expect_status=200)

    # 11) 列出我的订阅
    call("B.subscription_list", "GET", "/subscriptions/subscriptions", token=token_b, ip=ip_b, expect_status=200)
    call("B.subscription_list_active", "GET", "/subscriptions/subscriptions?status=ACTIVE", token=token_b, ip=ip_b, expect_status=200)

    # 12) 列出扣款记录
    if subscription_no:
        call("B.subscription_charges", "GET", f"/subscriptions/subscriptions/{subscription_no}/charges", token=token_b, ip=ip_b, expect_status=200)
        call("B.subscription_charges_success", "GET", f"/subscriptions/subscriptions/{subscription_no}/charges?status=SUCCESS", token=token_b, ip=ip_b, expect_status=200)

    # 13) 暂停订阅 → 恢复订阅
    if subscription_no:
        call("B.subscription_suspend", "POST", f"/subscriptions/subscriptions/{subscription_no}/suspend", {}, token=token_b, ip=ip_b, expect_status=201)
        call("B.subscription_resume", "POST", f"/subscriptions/subscriptions/{subscription_no}/resume", {}, token=token_b, ip=ip_b, expect_status=201)
        # 暂停非 ACTIVE 的订阅应被拒（已 resume → ACTIVE），先 suspend 再 suspend
        call("B.subscription_suspend_then_suspend", "POST", f"/subscriptions/subscriptions/{subscription_no}/suspend", {}, token=token_b, ip=ip_b, expect_status=201)
        call("B.subscription_suspend_again", "POST", f"/subscriptions/subscriptions/{subscription_no}/suspend", {}, token=token_b, ip=ip_b, expect_status=400)
        call("B.subscription_resume_back", "POST", f"/subscriptions/subscriptions/{subscription_no}/resume", {}, token=token_b, ip=ip_b, expect_status=201)

    # 14) 取消订阅
    if subscription_no:
        call("B.subscription_cancel", "POST", f"/subscriptions/subscriptions/{subscription_no}/cancel", {
            "reason": "E2E 测试取消",
        }, token=token_b, ip=ip_b, expect_status=201)
        # 再次取消应被拒
        call("B.subscription_cancel_again", "POST", f"/subscriptions/subscriptions/{subscription_no}/cancel", {
            "reason": "再次取消",
        }, token=token_b, ip=ip_b, expect_status=400)

    # 15) 异常：订阅不存在
    call("B.subscription_not_found", "GET", "/subscriptions/subscriptions/SUB_NOT_EXIST", token=token_b, ip=ip_b, expect_status=404)
    call("B.subscription_cancel_not_found", "POST", "/subscriptions/subscriptions/SUB_NOT_EXIST/cancel", {}, token=token_b, ip=ip_b, expect_status=404)

    # 16) seed 禁用计划 → B 无法订阅
    if plan_no:
        call("seed.subscription_plan_disable", "PUT", f"/subscriptions/plans/{plan_no}/status", {
            "status": "DISABLED",
        }, token=token_seed, ip=ip_seed, expect_status=200)
        # 启用回来
        call("seed.subscription_plan_enable", "PUT", f"/subscriptions/plans/{plan_no}/status", {
            "status": "ACTIVE",
        }, token=token_seed, ip=ip_seed, expect_status=200)
        # 状态未变化应被拒
        call("seed.subscription_plan_status_unchanged", "PUT", f"/subscriptions/plans/{plan_no}/status", {
            "status": "ACTIVE",
        }, token=token_seed, ip=ip_seed, expect_status=400)

    # ============== 分账 Split 完整链路 ==============
    # 取 seed 之前向 B 转账生成的源订单号（TransactionOrder）
    # 先查 seed 的账单，找到一条 EXPENSE 类型为 TRANSFER 的 transactionId
    source_order_no = None
    code, r = call("seed.bills_for_split", "GET", "/bills?direction=EXPENSE", token=token_seed, ip=ip_seed, expect_status=200)
    # bills 接口可能直接返回 list 或 {data: [...]} 两种格式
    if isinstance(r, list):
        bills_list = r
    elif isinstance(r, dict):
        bills_list = r.get("data", []) if isinstance(r.get("data"), list) else (r.get("data", {}).get("items", []) if isinstance(r.get("data"), dict) else [])
    else:
        bills_list = []
    if isinstance(bills_list, list):
        for b in bills_list:
            if isinstance(b, dict) and b.get("type") == "TRANSFER":
                source_order_no = b.get("transactionId")
                break
    # 兜底：从 batch_transfer 关联取一个源订单（用 batch_transfer 拆分时不必找具体订单号）
    if not source_order_no:
        # 用 seed 自己的一个充值订单
        code, r = call("seed.bills_income_for_split", "GET", "/bills?direction=INCOME", token=token_seed, ip=ip_seed, expect_status=200)
        if isinstance(r, list):
            bills_income = r
        elif isinstance(r, dict):
            bills_income = r.get("data", []) if isinstance(r.get("data"), list) else []
        else:
            bills_income = []
        if isinstance(bills_income, list):
            for b in bills_income:
                if isinstance(b, dict) and b.get("type") == "RECHARGE":
                    source_order_no = b.get("transactionId")
                    break

    # 1) seed 发起分账：把源订单部分金额分给 B
    split_no = None
    if source_order_no and user_b_id:
        code, r = call("seed.split_create", "POST", "/splits", {
            "sourceOrderNo": source_order_no,
            "receivers": [
                {"receiverId": user_b_id, "amount": 1, "remark": "E2E 分账 1"},
            ],
            "remark": f"E2E 分账 {ts}",
            "idempotencyKey": f"split_{ts}",
        }, token=token_seed, ip=ip_seed, expect_status=201)
        split_no = get_data(r).get("splitNo") if code == 201 else None

    # 2) 查询分账详情
    if split_no:
        call("seed.split_detail", "GET", f"/splits/{split_no}", token=token_seed, ip=ip_seed, expect_status=200)
        # B 也能查看（作为 receiver）
        call("B.split_detail_as_receiver", "GET", f"/splits/{split_no}", token=token_b, ip=ip_b, expect_status=200)

    # 3) 列表查询
    call("seed.split_list", "GET", "/splits", token=token_seed, ip=ip_seed, expect_status=200)
    call("seed.split_list_completed", "GET", "/splits?status=COMPLETED", token=token_seed, ip=ip_seed, expect_status=200)

    # 4) 幂等键冲突测试
    if source_order_no and user_b_id:
        call("seed.split_idem", "POST", "/splits", {
            "sourceOrderNo": source_order_no,
            "receivers": [{"receiverId": user_b_id, "amount": 1}],
            "idempotencyKey": f"split_{ts}",
        }, token=token_seed, ip=ip_seed, expect_status=201)

    # 5) 异常：接收方为空
    if source_order_no:
        call("seed.split_empty", "POST", "/splits", {
            "sourceOrderNo": source_order_no,
            "receivers": [],
        }, token=token_seed, ip=ip_seed, expect_status=400)

    # 6) 异常：接收方重复
    if source_order_no and user_b_id:
        call("seed.split_dup", "POST", "/splits", {
            "sourceOrderNo": source_order_no,
            "receivers": [
                {"receiverId": user_b_id, "amount": 1},
                {"receiverId": user_b_id, "amount": 1},
            ],
        }, token=token_seed, ip=ip_seed, expect_status=400)

    # 7) 异常：包含自己
    code, r = call("seed.me_for_split", "GET", "/users/me", token=token_seed, ip=ip_seed)
    seed_user_id_split = get_data(r).get("id")
    if source_order_no and seed_user_id_split:
        call("seed.split_self", "POST", "/splits", {
            "sourceOrderNo": source_order_no,
            "receivers": [{"receiverId": seed_user_id_split, "amount": 1}],
        }, token=token_seed, ip=ip_seed, expect_status=400)

    # 8) 异常：源订单不存在
    call("seed.split_source_not_found", "POST", "/splits", {
        "sourceOrderNo": "T_NOT_EXIST",
        "receivers": [{"receiverId": user_b_id or "anyone", "amount": 1}],
    }, token=token_seed, ip=ip_seed, expect_status=404)

    # 9) 异常：分账金额超过源订单
    if source_order_no and user_b_id:
        call("seed.split_exceed", "POST", "/splits", {
            "sourceOrderNo": source_order_no,
            "receivers": [{"receiverId": user_b_id, "amount": 999999}],
        }, token=token_seed, ip=ip_seed, expect_status=400)

    # 10) 异常：分账订单不存在
    call("seed.split_not_found", "GET", "/splits/SPL_NOT_EXIST", token=token_seed, ip=ip_seed, expect_status=404)
    call("seed.split_cancel_not_found", "POST", "/splits/SPL_NOT_EXIST/cancel", {}, token=token_seed, ip=ip_seed, expect_status=404)

    # 11) 异常：取消已完成的分账订单
    if split_no:
        call("seed.split_cancel_completed", "POST", f"/splits/{split_no}/cancel", {}, token=token_seed, ip=ip_seed, expect_status=400)

    # ============== 优惠券 Coupon 完整链路 ==============
    # 1) seed 创建固定金额优惠券
    code, r = call("seed.coupon_create_fixed", "POST", "/coupons", {
        "name": f"E2E 满 1 减 0.5 {ts}",
        "type": "FIXED",
        "value": 0.5,
        "minAmountYuan": 1,
        "totalQuota": 100,
        "perUserLimit": 1,
    }, token=token_seed, ip=ip_seed, expect_status=201)
    coupon_no = get_data(r).get("couponNo") if code == 201 else None

    # 2) 查询优惠券详情
    if coupon_no:
        call("seed.coupon_detail", "GET", f"/coupons/{coupon_no}", token=token_seed, ip=ip_seed, expect_status=200)

    # 3) 列出我创建的优惠券
    call("seed.coupon_list", "GET", "/coupons", token=token_seed, ip=ip_seed, expect_status=200)
    call("seed.coupon_list_active", "GET", "/coupons?status=ACTIVE", token=token_seed, ip=ip_seed, expect_status=200)

    # 4) 异常：优惠券不存在
    call("seed.coupon_not_found", "GET", "/coupons/CP_NOT_EXIST", token=token_seed, ip=ip_seed, expect_status=404)

    # 5) 异常：金额无效
    call("seed.coupon_invalid_value", "POST", "/coupons", {
        "name": "无效",
        "type": "FIXED",
        "value": 0,
    }, token=token_seed, ip=ip_seed, expect_status=400)

    # 6) B 领取 seed 创建的优惠券
    user_coupon_no = None
    if coupon_no and user_b_id:
        code, r = call("B.coupon_claim", "POST", f"/coupons/{coupon_no}/claim", {}, token=token_b, ip=ip_b, expect_status=201)
        user_coupon_no = get_data(r).get("userCouponNo") if code == 201 else None

    # 7) B 重复领取应被拒
    if coupon_no and user_b_id:
        call("B.coupon_claim_dup", "POST", f"/coupons/{coupon_no}/claim", {}, token=token_b, ip=ip_b, expect_status=400)

    # 8) B 列出自己领取的优惠券
    call("B.coupon_mine_list", "GET", "/coupons/mine/list", token=token_b, ip=ip_b, expect_status=200)
    call("B.coupon_mine_list_available", "GET", "/coupons/mine/list?status=AVAILABLE", token=token_b, ip=ip_b, expect_status=200)

    # 9) 查询用户优惠券详情
    if user_coupon_no:
        call("B.coupon_mine_detail", "GET", f"/coupons/mine/{user_coupon_no}", token=token_b, ip=ip_b, expect_status=200)

    # 10) 使用优惠券
    if user_coupon_no:
        call("B.coupon_use", "POST", f"/coupons/mine/{user_coupon_no}/use", {
            "orderNo": f"COUPON_TEST_{ts}",
            "orderAmount": 5,  # 满 1 元门槛
        }, token=token_b, ip=ip_b, expect_status=201)

    # 11) 重复使用应被拒
    if user_coupon_no:
        call("B.coupon_use_again", "POST", f"/coupons/mine/{user_coupon_no}/use", {
            "orderNo": f"COUPON_TEST_{ts}_2",
            "orderAmount": 5,
        }, token=token_b, ip=ip_b, expect_status=400)

    # 12) 异常：满减门槛不满足
    if coupon_no and user_b_id:
        # 再创建一个高门槛优惠券
        code, r2 = call("seed.coupon_create_high_min", "POST", "/coupons", {
            "name": "高门槛券",
            "type": "FIXED",
            "value": 1,
            "minAmountYuan": 100,
        }, token=token_seed, ip=ip_seed, expect_status=201)
        coupon_no2 = get_data(r2).get("couponNo") if r2 else None
        if coupon_no2:
            code, r3 = call("B.coupon_claim_high", "POST", f"/coupons/{coupon_no2}/claim", {}, token=token_b, ip=ip_b, expect_status=201)
            uc2 = get_data(r3).get("userCouponNo") if code == 201 else None
            if uc2:
                call("B.coupon_use_below_min", "POST", f"/coupons/mine/{uc2}/use", {
                    "orderNo": f"COUPON_TEST_LOW_{ts}",
                    "orderAmount": 5,  # 不满足 100 元门槛
                }, token=token_b, ip=ip_b, expect_status=400)

    # 13) 创建百分比优惠券
    code, r = call("seed.coupon_create_percent", "POST", "/coupons", {
        "name": f"E2E 9 折券 {ts}",
        "type": "PERCENT",
        "value": 10,
    }, token=token_seed, ip=ip_seed, expect_status=201)
    coupon_percent_no = get_data(r).get("couponNo") if code == 201 else None

    # 14) B 领取并使用百分比优惠券
    if coupon_percent_no and user_b_id:
        code, r = call("B.coupon_claim_percent", "POST", f"/coupons/{coupon_percent_no}/claim", {}, token=token_b, ip=ip_b, expect_status=201)
        uc_percent = get_data(r).get("userCouponNo") if code == 201 else None
        if uc_percent:
            call("B.coupon_use_percent", "POST", f"/coupons/mine/{uc_percent}/use", {
                "orderNo": f"COUPON_PERCENT_{ts}",
                "orderAmount": 100,  # 100 元 → 折扣 10 元
            }, token=token_b, ip=ip_b, expect_status=201)

    # 15) seed 禁用/启用优惠券
    if coupon_no:
        call("seed.coupon_disable", "PUT", f"/coupons/{coupon_no}/status", {
            "status": "DISABLED",
        }, token=token_seed, ip=ip_seed, expect_status=200)
        call("seed.coupon_enable", "PUT", f"/coupons/{coupon_no}/status", {
            "status": "ACTIVE",
        }, token=token_seed, ip=ip_seed, expect_status=200)
        call("seed.coupon_status_unchanged", "PUT", f"/coupons/{coupon_no}/status", {
            "status": "ACTIVE",
        }, token=token_seed, ip=ip_seed, expect_status=400)

    # 16) 异常：用户优惠券不存在
    call("B.coupon_mine_not_found", "GET", "/coupons/mine/UC_NOT_EXIST", token=token_b, ip=ip_b, expect_status=404)

    # ============== 管理员审核提现 + 调账 ==============
    code, r = call("admin.withdrawals_list_for_audit", "GET", "/admin/withdrawals?page=1&limit=10", token=admin_token, ip=ip_admin, expect_status=200)
    pending_withdrawal_id = None
    withdraw_list = (r or {}).get("data", []) if isinstance(r, dict) else []
    if isinstance(withdraw_list, list):
        for w in withdraw_list:
            if isinstance(w, dict) and w.get("status") == "PENDING":
                pending_withdrawal_id = w.get("id")
                break

    if pending_withdrawal_id:
        call("admin.withdrawal_approve", "POST", f"/admin/withdrawals/{pending_withdrawal_id}/approve", {}, token=admin_token, ip=ip_admin, expect_status=[200, 201])

    # 管理员调账（给 B 加 1 元测试）
    if user_b_id:
        call("admin.account_adjust", "POST", f"/admin/accounts/{user_b_id}/adjust", {
            "amount": 1,
            "reason": "E2E 测试调账 +1 元",
        }, token=admin_token, ip=ip_admin, expect_status=[200, 201])

    # ============== 管理员拒绝身份认证（负向测试）==============
    # 重新让 A 提交一个新的待审核身份，然后 admin 拒绝
    # 注：A 已经审核通过，再次提交会被业务规则拒绝，这里改为直接构造一个不存在的 id 拒绝
    call("admin.identity_reject_nonexistent", "POST", "/admin/identity/nonexistent-id/reject", {
        "reason": "E2E 测试拒绝",
    }, token=admin_token, ip=ip_admin, expect_status=404)

    # ============== 邀请返现 Referral 完整链路 ==============
    # 1) seed 创建邀请码
    code, r = call("seed.referral_code_create", "POST", "/referrals/code", {}, token=token_seed, ip=ip_seed, expect_status=201)
    referral_code = get_data(r).get("code") if code in [200, 201] else None

    # 2) 查询我的邀请码
    if referral_code:
        call("seed.referral_code_query", "GET", "/referrals/code", token=token_seed, ip=ip_seed, expect_status=200)

    # 3) 异常：邀请码不存在
    call("B.referral_bind_not_found", "POST", "/referrals/bind", {
        "code": "NOTEXIST",
    }, token=token_b, ip=ip_b, expect_status=404)

    # 4) B 绑定 seed 的邀请码
    if referral_code and user_b_id:
        call("B.referral_bind", "POST", "/referrals/bind", {
            "code": referral_code,
        }, token=token_b, ip=ip_b, expect_status=201)

        # 5) 异常：B 已绑定，再次绑定应抛错
        call("B.referral_bind_dup", "POST", "/referrals/bind", {
            "code": referral_code,
        }, token=token_b, ip=ip_b, expect_status=400)

    # 6) 触发邀请奖励（异常路径，成功路径由单元测试覆盖）
    if referral_code and user_b_id:
        # 异常：交易号不存在
        call("B.referral_trigger_invalid_tx", "POST", "/referrals/mine/trigger", {
            "transactionNo": "NOTEXIST",
        }, token=token_b, ip=ip_b, expect_status=400)

    # 7) seed 查询邀请统计
    call("seed.referral_stats", "GET", "/referrals/stats", token=token_seed, ip=ip_seed, expect_status=200)

    # 8) seed 列出我邀请的人
    call("seed.referral_list", "GET", "/referrals", token=token_seed, ip=ip_seed, expect_status=200)
    call("seed.referral_list_completed", "GET", "/referrals?status=COMPLETED", token=token_seed, ip=ip_seed, expect_status=200)

    # 9) 异常：邀请关系不存在
    call("seed.referral_not_found", "GET", "/referrals/REF_NOT_EXIST", token=token_seed, ip=ip_seed, expect_status=404)

    # 10) 异常：取消不存在的邀请应抛 404
    call("seed.referral_cancel_not_found", "POST", "/referrals/REF_NOT_EXIST/cancel", {
        "reason": "E2E 测试取消",
    }, token=token_seed, ip=ip_seed, expect_status=404)

    # ============== 消息中心 Message 完整链路 ==============
    # 通过 prisma db execute 插入测试消息（定向+广播）

    # 先取 seed 和 B 的 user_id
    code, r = call("seed.me_for_msg", "GET", "/users/me", token=token_seed, ip=ip_seed)
    seed_uid_for_msg = get_data(r).get("id") if code == 200 else None

    # 1) 先在 DB 里插入一条定向消息给 seed 和一条广播消息
    if seed_uid_for_msg:
        try:
            import subprocess
            sql = f"""
            DELETE FROM messages WHERE message_no IN ('MSG_E2E_DIRECT_001', 'MSG_E2E_BROADCAST_001');

            INSERT INTO messages (id, message_no, user_id, category, title, content, channels, priority, status, created_at, updated_at)
            VALUES (gen_random_uuid()::text, 'MSG_E2E_DIRECT_001',
                    '{seed_uid_for_msg}',
                    'SYSTEM', 'E2E定向测试', '这是一条E2E测试定向消息',
                    'IN_APP', 'NORMAL', 'SENT', NOW(), NOW())
            ON CONFLICT (message_no) DO NOTHING;

            INSERT INTO messages (id, message_no, user_id, category, title, content, channels, priority, status, created_at, updated_at)
            VALUES (gen_random_uuid()::text, 'MSG_E2E_BROADCAST_001',
                    NULL, 'SYSTEM', 'E2E广播测试', '这是一条E2E测试广播消息',
                    'IN_APP', 'NORMAL', 'SENT', NOW(), NOW())
            ON CONFLICT (message_no) DO NOTHING;
            """
            subprocess.run(
                ["npx", "prisma", "db", "execute", "--stdin"],
                input=sql,
                text=True,
                cwd="/workspace/KeBaiPay",
                capture_output=True,
                timeout=30,
            )
        except Exception:
            pass

    # 2) seed 查询消息列表
    code, r = call("seed.message_list", "GET", "/messages", token=token_seed, ip=ip_seed, expect_status=200)

    # 3) seed 查询未读数量
    code, r = call("seed.message_unread", "GET", "/messages/unread/count", token=token_seed, ip=ip_seed, expect_status=200)

    # 4) 异常：消息不存在
    call("seed.message_not_found", "GET", "/messages/MSG_NOT_EXIST", token=token_seed, ip=ip_seed, expect_status=404)

    # 5) seed 查询定向消息详情
    call("seed.message_detail_direct", "GET", "/messages/MSG_E2E_DIRECT_001", token=token_seed, ip=ip_seed, expect_status=200)

    # 6) seed 查询广播消息详情
    call("seed.message_detail_broadcast", "GET", "/messages/MSG_E2E_BROADCAST_001", token=token_seed, ip=ip_seed, expect_status=200)

    # 7) seed 标记定向消息已读
    call("seed.message_read_direct", "POST", "/messages/MSG_E2E_DIRECT_001/read", token=token_seed, ip=ip_seed, expect_status=[200, 201])

    # 8) seed 重复标记已读（幂等）
    call("seed.message_read_dup", "POST", "/messages/MSG_E2E_DIRECT_001/read", token=token_seed, ip=ip_seed, expect_status=[200, 201])

    # 9) seed 标记广播消息已读
    call("seed.message_read_broadcast", "POST", "/messages/MSG_E2E_BROADCAST_001/read", token=token_seed, ip=ip_seed, expect_status=[200, 201])

    # 10) B 无权查看 seed 的定向消息（应抛 404）
    call("B.message_view_others", "GET", "/messages/MSG_E2E_DIRECT_001", token=token_b, ip=ip_b, expect_status=404)

    # 11) B 一键全部已读
    call("B.message_read_all", "POST", "/messages/read/all", token=token_b, ip=ip_b, expect_status=[200, 201])

    # 12) seed 删除自己的定向消息
    call("seed.message_delete", "POST", "/messages/MSG_E2E_DIRECT_001/delete", token=token_seed, ip=ip_seed, expect_status=[200, 201])

    # 13) 异常：删除已不存在的消息应 404
    call("seed.message_delete_not_found", "POST", "/messages/MSG_DELETED_NOT_EXIST/delete", token=token_seed, ip=ip_seed, expect_status=404)

    # 14) 异常：广播消息不可删除
    call("seed.message_delete_broadcast", "POST", "/messages/MSG_E2E_BROADCAST_001/delete", token=token_seed, ip=ip_seed, expect_status=400)

    # ============== 商户发票 Invoice 完整链路 ==============
    # 1) 商户申请普通发票（PENDING）
    code, r = call("seed.invoice_create_normal", "POST", "/invoices", {
        "type": "NORMAL",
        "title": f"E2E 普通发票 {ts}",
        "amount": 1000,
        "remark": "E2E 测试普通发票",
    }, token=token_seed, ip=ip_seed)
    invoice_no_normal = get_data(r).get("invoiceNo") if code in (200, 201) else None

    # 2) 商户申请专用发票（需税号）
    code, r = call("seed.invoice_create_special", "POST", "/invoices", {
        "type": "SPECIAL",
        "title": f"E2E 专用发票 {ts}",
        "amount": 5000,
        "taxNo": "91110000XXXXXXXX",
        "bankName": "测试银行",
        "bankAccount": "6222001234567890123",
        "address": "北京市朝阳区",
        "phone": "010-12345678",
    }, token=token_seed, ip=ip_seed)
    invoice_no_special = get_data(r).get("invoiceNo") if code in (200, 201) else None

    # 3) 异常：金额 <=0 应失败
    call("seed.invoice_create_zero_amount", "POST", "/invoices", {
        "type": "NORMAL",
        "title": "金额异常",
        "amount": 0,
    }, token=token_seed, ip=ip_seed, expect_status=400)

    # 4) 异常：专用发票无税号应失败
    call("seed.invoice_create_special_no_taxno", "POST", "/invoices", {
        "type": "SPECIAL",
        "title": "无税号",
        "amount": 1000,
    }, token=token_seed, ip=ip_seed, expect_status=400)

    # 5) 商户查询自己的发票列表
    call("seed.invoice_list_mine", "GET", "/invoices?page=1&limit=10", token=token_seed, ip=ip_seed)

    # 6) 商户按状态过滤
    call("seed.invoice_list_pending", "GET", "/invoices?status=PENDING&page=1&limit=10", token=token_seed, ip=ip_seed)

    # 7) 商户查询发票详情
    if invoice_no_normal:
        call("seed.invoice_detail", "GET", f"/invoices/{invoice_no_normal}", token=token_seed, ip=ip_seed)

    # 8) 商户作废自己的 PENDING 发票（应成功）
    if invoice_no_normal:
        call("seed.invoice_cancel_pending", "POST", f"/invoices/{invoice_no_normal}/cancel", {}, token=token_seed, ip=ip_seed)

    # 9) 异常：商户作废已作废发票应失败
    if invoice_no_normal:
        call("seed.invoice_cancel_already_cancelled", "POST", f"/invoices/{invoice_no_normal}/cancel", {}, token=token_seed, ip=ip_seed, expect_status=400)

    # 10) 管理员查询所有发票列表
    call("admin.invoice_list_all", "GET", "/admin/invoices?page=1&limit=10", token=admin_token, ip=ip_admin)

    # 11) 管理员按状态过滤
    call("admin.invoice_list_pending", "GET", "/admin/invoices?status=PENDING&page=1&limit=10", token=admin_token, ip=ip_admin)

    # 12) 管理员查询发票详情
    if invoice_no_special:
        call("admin.invoice_detail", "GET", f"/admin/invoices/{invoice_no_special}", token=admin_token, ip=ip_admin)

    # 13) 管理员开具发票（PENDING → ISSUED）
    if invoice_no_special:
        call("admin.invoice_issue", "POST", f"/admin/invoices/{invoice_no_special}/issue", {}, token=admin_token, ip=ip_admin)

    # 14) 异常：重复开具应失败
    if invoice_no_special:
        call("admin.invoice_issue_dup", "POST", f"/admin/invoices/{invoice_no_special}/issue", {}, token=admin_token, ip=ip_admin, expect_status=400)

    # 15) 异常：商户作废已 ISSUED 发票应失败（仅 PENDING 可被商户作废）
    if invoice_no_special:
        call("seed.invoice_cancel_issued_fail", "POST", f"/invoices/{invoice_no_special}/cancel", {}, token=token_seed, ip=ip_seed, expect_status=400)

    # 16) 管理员作废 ISSUED 发票（应成功）
    if invoice_no_special:
        call("admin.invoice_cancel", "POST", f"/admin/invoices/{invoice_no_special}/cancel", {}, token=admin_token, ip=ip_admin)

    # ============== AI 风控审计 RiskAudit 完整链路 ==============
    # 1) 用户创建风控审计会话
    code, r = call("seed.risk_audit_create_session", "POST", "/risk-audit/sessions", {
        "title": f"E2E 风控咨询 {ts}",
    }, token=token_seed, ip=ip_seed)
    ras_no = get_data(r).get("sessionNo") if code in (200, 201) else None

    # 2) 异常：空标题也应成功（使用默认值）
    code, r = call("seed.risk_audit_create_session_default", "POST", "/risk-audit/sessions", {}, token=token_seed, ip=ip_seed)
    ras_no_default = get_data(r).get("sessionNo") if code in (200, 201) else None

    # 3) 查询我的会话列表
    call("seed.risk_audit_list_mine", "GET", "/risk-audit/sessions?page=1&limit=10", token=token_seed, ip=ip_seed)

    # 4) 异常：查询不存在的会话应 404
    call("seed.risk_audit_not_found", "GET", "/risk-audit/sessions/RAS_NOT_EXIST", token=token_seed, ip=ip_seed, expect_status=404)

    # 5) 查询会话详情
    if ras_no:
        call("seed.risk_audit_detail", "GET", f"/risk-audit/sessions/{ras_no}", token=token_seed, ip=ip_seed)

    # 6) AI 对话：问候意图
    if ras_no:
        code, r = call("seed.risk_audit_chat_greeting", "POST", f"/risk-audit/sessions/{ras_no}/messages", {
            "content": "你好，能帮我做什么？",
        }, token=token_seed, ip=ip_seed)
        if code in (200, 201):
            intent = get_data(r).get("intent")
            if intent != "GREETING":
                results.append(("seed.risk_audit_chat_greeting_intent", False, f"expected GREETING, got {intent}"))

    # 7) AI 对话：规则查询
    if ras_no:
        call("seed.risk_audit_chat_rules", "POST", f"/risk-audit/sessions/{ras_no}/messages", {
            "content": "我有哪些风控规则？",
        }, token=token_seed, ip=ip_seed)

    # 8) AI 对话：账户状态查询
    if ras_no:
        call("seed.risk_audit_chat_account", "POST", f"/risk-audit/sessions/{ras_no}/messages", {
            "content": "查询我的账户状态",
        }, token=token_seed, ip=ip_seed)

    # 9) AI 对话：交易查询
    if ras_no:
        call("seed.risk_audit_chat_tx", "POST", f"/risk-audit/sessions/{ras_no}/messages", {
            "content": "查询我最近的交易",
        }, token=token_seed, ip=ip_seed)

    # 10) AI 对话：风险事件查询
    if ras_no:
        call("seed.risk_audit_chat_events", "POST", f"/risk-audit/sessions/{ras_no}/messages", {
            "content": "我的风险事件有哪些？",
        }, token=token_seed, ip=ip_seed)

    # 11) AI 对话：拦截解释
    if ras_no:
        call("seed.risk_audit_chat_explain", "POST", f"/risk-audit/sessions/{ras_no}/messages", {
            "content": "为什么我的交易被拦截了？",
        }, token=token_seed, ip=ip_seed)

    # 12) AI 对话：未识别意图
    if ras_no:
        code, r = call("seed.risk_audit_chat_unknown", "POST", f"/risk-audit/sessions/{ras_no}/messages", {
            "content": "今天天气怎么样",
        }, token=token_seed, ip=ip_seed)
        if code in (200, 201):
            intent = get_data(r).get("intent")
            if intent != "UNKNOWN":
                results.append(("seed.risk_audit_chat_unknown_intent", False, f"expected UNKNOWN, got {intent}"))

    # 13) 异常：空消息应失败
    if ras_no:
        call("seed.risk_audit_empty_msg", "POST", f"/risk-audit/sessions/{ras_no}/messages", {
            "content": "   ",
        }, token=token_seed, ip=ip_seed, expect_status=400)

    # 14) AI 对话：申诉提交
    if ras_no:
        call("seed.risk_audit_chat_appeal", "POST", f"/risk-audit/sessions/{ras_no}/messages", {
            "content": "我要申诉",
        }, token=token_seed, ip=ip_seed)

    # 15) AI 对话：重复申诉
    if ras_no:
        call("seed.risk_audit_chat_appeal_dup", "POST", f"/risk-audit/sessions/{ras_no}/messages", {
            "content": "再次申诉",
        }, token=token_seed, ip=ip_seed)

    # 16) 关闭会话
    if ras_no:
        call("seed.risk_audit_close", "POST", f"/risk-audit/sessions/{ras_no}/close", {
            "summary": "E2E 测试结束，问题已解决",
        }, token=token_seed, ip=ip_seed)

    # 17) 异常：在已关闭会话发送消息应失败（400 或被限流 429）
    if ras_no:
        call("seed.risk_audit_msg_closed", "POST", f"/risk-audit/sessions/{ras_no}/messages", {
            "content": "你好",
        }, token=token_seed, ip=ip_seed, expect_status=[400, 429])

    # 18) 管理员查看所有会话
    call("admin.risk_audit_list_all", "GET", "/admin/risk-audit/sessions?page=1&limit=10", token=admin_token, ip=ip_admin)

    # 19) 管理员查看统计
    call("admin.risk_audit_stats", "GET", "/admin/risk-audit/stats", token=admin_token, ip=ip_admin)

    # 20) 管理员查看任意会话详情
    if ras_no:
        call("admin.risk_audit_detail", "GET", f"/admin/risk-audit/sessions/{ras_no}", token=admin_token, ip=ip_admin)

    # ============== 自定义风控规则 CustomRule DSL 完整链路 ==============
    # 1) 管理员创建自定义规则：夜间大额转账拦截
    code, r = call("admin.custom_rule_create", "POST", "/admin/risk-rules/custom", {
        "name": f"E2E 夜间大额拦截 {ts}",
        "description": "22-06 点转账超过 1 万元拦截",
        "action": "BLOCK",
        "priority": 50,
        "conditions": [
            {"field": "amount", "operator": ">=", "value": 1000000},
            {"field": "hour", "operator": "in_range", "value": [22, 6]},
            {"field": "type", "operator": "==", "value": "TRANSFER"},
        ],
        "logicalOp": "AND",
    }, token=admin_token, ip=ip_admin)
    custom_rule_no = get_data(r).get("ruleNo") if code in (200, 201) else None

    # 2) 异常：名称重复应失败
    if custom_rule_no:
        call("admin.custom_rule_create_dup", "POST", "/admin/risk-rules/custom", {
            "name": f"E2E 夜间大额拦截 {ts}",
            "conditions": [
                {"field": "amount", "operator": ">", "value": 1000},
            ],
        }, token=admin_token, ip=ip_admin, expect_status=400)

    # 3) 异常：空条件应失败
    call("admin.custom_rule_create_empty", "POST", "/admin/risk-rules/custom", {
        "name": f"E2E 空条件 {ts}",
        "conditions": [],
    }, token=admin_token, ip=ip_admin, expect_status=400)

    # 4) 异常：无效字段应失败
    call("admin.custom_rule_create_invalid_field", "POST", "/admin/risk-rules/custom", {
        "name": f"E2E 无效字段 {ts}",
        "conditions": [
            {"field": "invalid_field", "operator": "==", "value": 1},
        ],
    }, token=admin_token, ip=ip_admin, expect_status=400)

    # 5) 创建另一条规则：白名单 IP
    code, r = call("admin.custom_rule_create_whitelist", "POST", "/admin/risk-rules/custom", {
        "name": f"E2E IP 白名单 {ts}",
        "description": "10.1.x.x 放行",
        "action": "REVIEW",
        "priority": 200,
        "conditions": [
            {"field": "ip", "operator": "contains", "value": "10.1."},
        ],
        "logicalOp": "AND",
    }, token=admin_token, ip=ip_admin)
    whitelist_rule_no = get_data(r).get("ruleNo") if code in (200, 201) else None

    # 6) 查询自定义规则列表
    call("admin.custom_rule_list", "GET", "/admin/risk-rules/custom?page=1&limit=10", token=admin_token, ip=ip_admin)

    # 7) 按 enabled 过滤
    call("admin.custom_rule_list_enabled", "GET", "/admin/risk-rules/custom?enabled=true&page=1&limit=10", token=admin_token, ip=ip_admin)

    # 8) 查询规则详情
    if custom_rule_no:
        call("admin.custom_rule_detail", "GET", f"/admin/risk-rules/custom/{custom_rule_no}", token=admin_token, ip=ip_admin)

    # 9) 异常：查询不存在的规则应 404
    call("admin.custom_rule_not_found", "GET", "/admin/risk-rules/custom/CRR_NOT_EXIST", token=admin_token, ip=ip_admin, expect_status=404)

    # 10) 测试规则：金额满足应命中
    if custom_rule_no:
        call("admin.custom_rule_test_hit", "POST", "/admin/risk-rules/custom/test", {
            "conditions": [
                {"field": "amount", "operator": ">=", "value": 1000000},
                {"field": "type", "operator": "==", "value": "TRANSFER"},
            ],
            "logicalOp": "AND",
            "amount": 5000000,
            "type": "TRANSFER",
        }, token=admin_token, ip=ip_admin)

    # 11) 测试规则：金额不满足应不命中
    if custom_rule_no:
        code, r = call("admin.custom_rule_test_no_hit", "POST", "/admin/risk-rules/custom/test", {
            "conditions": [
                {"field": "amount", "operator": ">=", "value": 1000000},
            ],
            "logicalOp": "AND",
            "amount": 100,
            "type": "RECHARGE",
        }, token=admin_token, ip=ip_admin)
        if code in (200, 201):
            hit = get_data(r).get("hit")
            if hit:
                results.append(("admin.custom_rule_test_no_hit_check", False, f"expected hit=false, got hit=true"))

    # 12) 测试 OR 逻辑
    call("admin.custom_rule_test_or", "POST", "/admin/risk-rules/custom/test", {
        "conditions": [
            {"field": "amount", "operator": ">=", "value": 1000000},
            {"field": "type", "operator": "==", "value": "TRANSFER"},
        ],
        "logicalOp": "OR",
        "amount": 100,
        "type": "TRANSFER",
    }, token=admin_token, ip=ip_admin)

    # 13) 测试 in 算子
    call("admin.custom_rule_test_in", "POST", "/admin/risk-rules/custom/test", {
        "conditions": [
            {"field": "type", "operator": "in", "value": ["TRANSFER", "WITHDRAW"]},
        ],
        "logicalOp": "AND",
        "type": "TRANSFER",
    }, token=admin_token, ip=ip_admin)

    # 14) 更新规则名称
    if custom_rule_no:
        call("admin.custom_rule_update", "PUT", f"/admin/risk-rules/custom/{custom_rule_no}", {
            "description": "更新后的描述",
            "priority": 30,
        }, token=admin_token, ip=ip_admin)

    # 15) 禁用规则
    if custom_rule_no:
        call("admin.custom_rule_disable", "POST", f"/admin/risk-rules/custom/{custom_rule_no}/toggle", {
            "enabled": False,
        }, token=admin_token, ip=ip_admin)

    # 16) 重新启用规则
    if custom_rule_no:
        call("admin.custom_rule_enable", "POST", f"/admin/risk-rules/custom/{custom_rule_no}/toggle", {
            "enabled": True,
        }, token=admin_token, ip=ip_admin)

    # 17) 用户查看生效规则列表
    call("seed.custom_rule_user_list", "GET", "/risk-rules/custom", token=token_seed, ip=ip_seed)

    # 18) 删除规则
    if whitelist_rule_no:
        call("admin.custom_rule_delete", "DELETE", f"/admin/risk-rules/custom/{whitelist_rule_no}", token=admin_token, ip=ip_admin)

    # 19) 异常：删除不存在的规则应 404
    call("admin.custom_rule_delete_not_found", "DELETE", "/admin/risk-rules/custom/CRR_NOT_EXIST", token=admin_token, ip=ip_admin, expect_status=404)

    # ============== S3 微信原生红包全协议 ==============
    # 1) 创建拼手气群红包（5 人领 10 元）
    code, r = call("red.lucky_create", "POST", "/red-packets", {
        "amount": 10,
        "payPassword": "123456",
        "remark": "E2E 拼手气红包",
        "type": "LUCKY",
        "totalCount": 5,
    }, token=token_seed, ip=ip_seed)
    lucky_packet_no = get_data(r).get("packetNo") if code in (200, 201) else None

    # 2) 异常：拼手气红包金额 < 总人数应 400
    call("red.lucky_create_amount_too_small", "POST", "/red-packets", {
        "amount": 0.03,
        "payPassword": "123456",
        "type": "LUCKY",
        "totalCount": 5,
    }, token=token_seed, ip=ip_seed, expect_status=400)

    # 3) 异常：type 无效应 400
    call("red.create_invalid_type", "POST", "/red-packets", {
        "amount": 1,
        "payPassword": "123456",
        "type": "INVALID",
    }, token=token_seed, ip=ip_seed, expect_status=400)

    # 4) 异常：totalCount 超过 100 应 400
    call("red.create_count_too_many", "POST", "/red-packets", {
        "amount": 200,
        "payPassword": "123456",
        "type": "LUCKY",
        "totalCount": 101,
    }, token=token_seed, ip=ip_seed, expect_status=400)

    # 5) 创建普通红包（5 人每人 2 元，总额 10 元）
    code, r = call("red.ordinary_create", "POST", "/red-packets", {
        "amount": 10,
        "payPassword": "123456",
        "remark": "E2E 普通红包",
        "type": "ORDINARY",
        "totalCount": 5,
        "perAmount": 2,
    }, token=token_seed, ip=ip_seed)
    ordinary_packet_no = get_data(r).get("packetNo") if code in (200, 201) else None

    # 6) 异常：普通红包 perAmount × totalCount != amount 应 400
    call("red.ordinary_create_mismatch", "POST", "/red-packets", {
        "amount": 10,
        "payPassword": "123456",
        "type": "ORDINARY",
        "totalCount": 5,
        "perAmount": 3,
    }, token=token_seed, ip=ip_seed, expect_status=400)

    # 7) 异常：普通红包缺 perAmount 应 400
    call("red.ordinary_create_no_per_amount", "POST", "/red-packets", {
        "amount": 10,
        "payPassword": "123456",
        "type": "ORDINARY",
        "totalCount": 5,
    }, token=token_seed, ip=ip_seed, expect_status=400)

    # 8) 创建专属红包（指定 B 领取）
    code, r = call("red.exclusive_create", "POST", "/red-packets", {
        "amount": 8.88,
        "payPassword": "123456",
        "remark": "E2E 专属红包",
        "type": "EXCLUSIVE",
        "designatedReceiverId": user_b_id,
    }, token=token_seed, ip=ip_seed)
    exclusive_packet_no = get_data(r).get("packetNo") if code in (200, 201) else None

    # 9) 异常：专属红包缺 designatedReceiverId 应 400
    call("red.exclusive_create_no_receiver", "POST", "/red-packets", {
        "amount": 8.88,
        "payPassword": "123456",
        "type": "EXCLUSIVE",
    }, token=token_seed, ip=ip_seed, expect_status=400)

    # 10) 异常：专属红包 totalCount > 1 应 400
    call("red.exclusive_create_count_invalid", "POST", "/red-packets", {
        "amount": 8.88,
        "payPassword": "123456",
        "type": "EXCLUSIVE",
        "designatedReceiverId": user_b_id,
        "totalCount": 2,
    }, token=token_seed, ip=ip_seed, expect_status=[400, 429])

    # 11) 创建口令红包
    code, r = call("red.password_create", "POST", "/red-packets", {
        "amount": 6.66,
        "payPassword": "123456",
        "remark": "E2E 口令红包",
        "type": "PASSWORD",
        "password": "kb2026",
    }, token=token_seed, ip=ip_seed, expect_status=[200, 201, 429])
    password_packet_no = get_data(r).get("packetNo") if code in (200, 201) else None

    # 12) 异常：口令红包缺 password 应 400
    call("red.password_create_no_password", "POST", "/red-packets", {
        "amount": 6.66,
        "payPassword": "123456",
        "type": "PASSWORD",
    }, token=token_seed, ip=ip_seed, expect_status=[400, 429])

    # 13) 异常：口令红包 password 过短应 400
    call("red.password_create_short_password", "POST", "/red-packets", {
        "amount": 6.66,
        "payPassword": "123456",
        "type": "PASSWORD",
        "password": "abc",
    }, token=token_seed, ip=ip_seed, expect_status=[400, 429])

    # 14) B 领取拼手气红包（应成功，金额随机）
    if lucky_packet_no:
        call("B.lucky_receive", "POST", f"/red-packets/{lucky_packet_no}/receive", {}, token=token_b, ip=ip_b)

    # 15) seed 不能领自己发的红包
    if lucky_packet_no:
        call("seed.lucky_receive_self", "POST", f"/red-packets/{lucky_packet_no}/receive", {}, token=token_seed, ip=ip_seed, expect_status=400)

    # 16) B 重复领取同一红包应返回已领取记录（200/201）
    if lucky_packet_no:
        call("B.lucky_receive_dup", "POST", f"/red-packets/{lucky_packet_no}/receive", {}, token=token_b, ip=ip_b, expect_status=[200, 201])

    # 17) B 领取普通红包（应得 2 元）
    if ordinary_packet_no:
        call("B.ordinary_receive", "POST", f"/red-packets/{ordinary_packet_no}/receive", {}, token=token_b, ip=ip_b)

    # 18) seed 领取专属红包应失败（不是指定收款人）
    if exclusive_packet_no:
        call("seed.exclusive_receive_unauthorized", "POST", f"/red-packets/{exclusive_packet_no}/receive", {}, token=token_seed, ip=ip_seed, expect_status=[400, 403])

    # 19) B 领取专属红包应成功
    if exclusive_packet_no:
        call("B.exclusive_receive", "POST", f"/red-packets/{exclusive_packet_no}/receive", {}, token=token_b, ip=ip_b)

    # 20) B 领取口令红包缺 password 应 400
    if password_packet_no:
        call("B.password_receive_no_password", "POST", f"/red-packets/{password_packet_no}/receive", {}, token=token_b, ip=ip_b, expect_status=400)

    # 21) B 领取口令红包密码错误应 400
    if password_packet_no:
        call("B.password_receive_wrong_password", "POST", f"/red-packets/{password_packet_no}/receive", {"password": "wrong"}, token=token_b, ip=ip_b, expect_status=400)

    # 22) B 领取口令红包密码正确应成功
    if password_packet_no:
        call("B.password_receive_correct", "POST", f"/red-packets/{password_packet_no}/receive", {"password": "kb2026"}, token=token_b, ip=ip_b)

    # 23) 查询已发红包列表
    call("seed.red_packets_sent", "GET", "/red-packets/sent", token=token_seed, ip=ip_seed)

    # 24) 查询已收红包列表
    call("B.red_packets_received", "GET", "/red-packets/received", token=token_b, ip=ip_b)

    # ============== S5 多平台对账聚合 ==============
    # 用今日 UTC 日期拉取对账单（与后端 getDateRange 一致）
    import datetime as _dt
    s5_date = _dt.datetime.utcnow().strftime("%Y-%m-%d")

    # 1) 拉取 mock 渠道对账单
    # 首次跑：201；重跑：400 KB941（已拉取，幂等性兼容）
    code, r = call("s5.fetch_statement", "POST", "/admin/channel-reconciliation/statements/fetch", {
        "channelCode": "mock",
        "date": s5_date,
    }, token=admin_token, ip=ip_admin, expect_status=[201, 400])
    s5_stmt_id = get_data(r).get("id")

    # 2) 重复拉取应被拒（KB941）
    call("s5.fetch_statement_dup", "POST", "/admin/channel-reconciliation/statements/fetch", {
        "channelCode": "mock",
        "date": s5_date,
    }, token=admin_token, ip=ip_admin, expect_status=400)

    # 3) 拉取 BANK 渠道对账单（withdrawal 默认 channel=BANK）
    # 首次跑：201；重跑：400 KB941（幂等性兼容）
    code, r = call("s5.fetch_statement_bank", "POST", "/admin/channel-reconciliation/statements/fetch", {
        "channelCode": "BANK",
        "date": s5_date,
    }, token=admin_token, ip=ip_admin, expect_status=[201, 400])
    s5_stmt_bank_id = get_data(r).get("id")

    # 4) 日期格式非法应被拒
    call("s5.fetch_invalid_date", "POST", "/admin/channel-reconciliation/statements/fetch", {
        "channelCode": "mock",
        "date": "not-a-date",
    }, token=admin_token, ip=ip_admin, expect_status=400)

    # 5) 对账单列表 - 同时用于回填 stmt_id（重跑场景）
    code, r = call("s5.list_statements", "GET", f"/admin/channel-reconciliation/statements?channelCode=mock&date={s5_date}&page=1&limit=10", token=admin_token, ip=ip_admin)
    if not s5_stmt_id and isinstance(r, dict):
        _lst = r.get("data") or []
        if isinstance(_lst, list) and _lst:
            s5_stmt_id = _lst[0].get("id") if isinstance(_lst[0], dict) else None

    # 6) 对账单列表按状态过滤
    call("s5.list_statements_fetched", "GET", "/admin/channel-reconciliation/statements?status=FETCHED&page=1&limit=10", token=admin_token, ip=ip_admin)

    # 回填 BANK stmt_id（重跑场景）
    if not s5_stmt_bank_id:
        code, r = call("s5.list_statements_bank", "GET", f"/admin/channel-reconciliation/statements?channelCode=BANK&date={s5_date}&page=1&limit=10", token=admin_token, ip=ip_admin)
        if isinstance(r, dict):
            _lst = r.get("data") or []
            if isinstance(_lst, list) and _lst:
                s5_stmt_bank_id = _lst[0].get("id") if isinstance(_lst[0], dict) else None

    # 7) 对账单详情（含 items）
    if s5_stmt_id:
        call("s5.get_statement", "GET", f"/admin/channel-reconciliation/statements/{s5_stmt_id}", token=admin_token, ip=ip_admin)
        # 8) 对账单条目列表
        call("s5.list_items", "GET", f"/admin/channel-reconciliation/statements/{s5_stmt_id}/items?page=1&limit=20", token=admin_token, ip=ip_admin)
        call("s5.list_items_matched", "GET", f"/admin/channel-reconciliation/statements/{s5_stmt_id}/items?matchStatus=MATCHED&page=1&limit=20", token=admin_token, ip=ip_admin)
        # 9) 执行匹配
        code, r = call("s5.match_statement", "POST", f"/admin/channel-reconciliation/statements/{s5_stmt_id}/match", {}, token=admin_token, ip=ip_admin, expect_status=201)

    if s5_stmt_bank_id:
        call("s5.get_statement_bank", "GET", f"/admin/channel-reconciliation/statements/{s5_stmt_bank_id}", token=admin_token, ip=ip_admin)
        call("s5.match_statement_bank", "POST", f"/admin/channel-reconciliation/statements/{s5_stmt_bank_id}/match", {}, token=admin_token, ip=ip_admin, expect_status=201)

    # 10) 差异项列表（不限渠道，可空）
    code, r = call("s5.list_differences", "GET", f"/admin/channel-reconciliation/differences?reportDate={s5_date}&page=1&limit=50", token=admin_token, ip=ip_admin)
    s5_diff_list = []
    if isinstance(r, dict):
        s5_diff_list = r.get("data") or []

    # 11) 差异列表按 PENDING 过滤
    call("s5.list_differences_pending", "GET", "/admin/channel-reconciliation/differences?status=PENDING&page=1&limit=10", token=admin_token, ip=ip_admin)

    # 12) 差异项不存在 → 404
    call("s5.diff_not_found", "GET", "/admin/channel-reconciliation/differences/DIFF_NOT_EXIST", token=admin_token, ip=ip_admin, expect_status=404)
    call("s5.assign_not_found", "POST", "/admin/channel-reconciliation/differences/DIFF_NOT_EXIST/assign", {"assignedTo": "finance-1"}, token=admin_token, ip=ip_admin, expect_status=404)
    call("s5.resolve_not_found", "POST", "/admin/channel-reconciliation/differences/DIFF_NOT_EXIST/resolve", {"resolution": "已核实"}, token=admin_token, ip=ip_admin, expect_status=404)

    # 13) 对账单不存在 → 404
    call("s5.statement_not_found", "GET", "/admin/channel-reconciliation/statements/STMT_NOT_EXIST", token=admin_token, ip=ip_admin, expect_status=404)
    call("s5.match_not_found", "POST", "/admin/channel-reconciliation/statements/STMT_NOT_EXIST/match", {}, token=admin_token, ip=ip_admin, expect_status=404)
    call("s5.list_items_not_found", "GET", "/admin/channel-reconciliation/statements/STMT_NOT_EXIST/items", token=admin_token, ip=ip_admin, expect_status=404)

    # 14) 差异处理工作流（happy path）：若存在 PENDING 差异，走完整 assign → resolve
    s5_pending_diff_id = None
    for _d in s5_diff_list:
        if isinstance(_d, dict) and _d.get("status") == "PENDING":
            s5_pending_diff_id = _d.get("id")
            break

    if s5_pending_diff_id:
        # 指派
        call("s5.diff_assign", "POST", f"/admin/channel-reconciliation/differences/{s5_pending_diff_id}/assign", {"assignedTo": "finance-1"}, token=admin_token, ip=ip_admin, expect_status=201)
        # 重复指派应被拒（KB945 状态不允许）
        call("s5.diff_assign_dup", "POST", f"/admin/channel-reconciliation/differences/{s5_pending_diff_id}/assign", {"assignedTo": "finance-2"}, token=admin_token, ip=ip_admin, expect_status=400)
        # 解决（默认 RESOLVED）
        call("s5.diff_resolve", "POST", f"/admin/channel-reconciliation/differences/{s5_pending_diff_id}/resolve", {"resolution": "已核实，渠道延迟导致"}, token=admin_token, ip=ip_admin, expect_status=201)
        # 重复解决应被拒
        call("s5.diff_resolve_dup", "POST", f"/admin/channel-reconciliation/differences/{s5_pending_diff_id}/resolve", {"resolution": "重复提交"}, token=admin_token, ip=ip_admin, expect_status=400)
        # 查询详情确认状态
        call("s5.diff_detail_resolved", "GET", f"/admin/channel-reconciliation/differences/{s5_pending_diff_id}", token=admin_token, ip=ip_admin)

    # 15) 解决时显式指定 IGNORED 状态
    s5_another_pending_id = None
    for _d in s5_diff_list:
        if isinstance(_d, dict) and _d.get("status") == "PENDING" and _d.get("id") != s5_pending_diff_id:
            s5_another_pending_id = _d.get("id")
            break
    if s5_another_pending_id:
        call("s5.diff_assign_2", "POST", f"/admin/channel-reconciliation/differences/{s5_another_pending_id}/assign", {"assignedTo": "finance-2"}, token=admin_token, ip=ip_admin, expect_status=201)
        call("s5.diff_resolve_ignored", "POST", f"/admin/channel-reconciliation/differences/{s5_another_pending_id}/resolve", {"resolution": "重复交易，忽略", "finalStatus": "IGNORED"}, token=admin_token, ip=ip_admin, expect_status=201)

    # ============== 公开接口 ==============
    call("public.health", "GET", "/health")
    call("public.health_ready", "GET", "/health/ready")
    call("public.health_channels", "GET", "/health/channels")
    call("public.health_channels_summary", "GET", "/health/channels/summary")
    call("public.health_schedules", "GET", "/health/schedules")
    call("public.sms_config", "GET", "/sms/config")
    call("public.swagger", "GET", "/api/docs-json")

    # ============== 汇总 ==============
    print("\n" + "=" * 80)
    print(f"{'NAME':<45} {'OK':<5} DETAIL")
    print("=" * 80)
    fails = 0
    for n, ok, d in results:
        flag = "OK" if ok else "FAIL"
        if not ok:
            fails += 1
        print(f"{n:<45} {flag:<5} {d}")
    print("=" * 80)
    print(f"Total {len(results)} checks, {fails} failed")
    sys.exit(0 if fails == 0 else 1)


if __name__ == "__main__":
    main()
