const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const KV_KEY = "nf_orders";

// Feishu config
const FEISHU_APP_ID = process.env.FEISHU_APP_ID || "";
const FEISHU_APP_SECRET = process.env.FEISHU_APP_SECRET || "";
const FEISHU_BITABLE_TOKEN = "H0dlbqN5qageHQscTTEc9aqKnmc";
const FEISHU_TABLE_ID = "tbllSBgcrMDvJtDk";
const FEISHU_CHAT_ID = "oc_864d8e4c92eb2704057c95676e11e5a5";

let _feishuToken = null;
let _feishuTokenExp = 0;

const PLAN_INFO = {
  '个人高阶版': { price: 75, cost: 45 },
  '个人旗舰版': { price: 120, cost: 89 },
  '个人尊享版': { price: 0, cost: 0 }
};
const FEE_RATE = {
  '波比': 0.016,
  '周众': 0.006,
  '周众（孙尚香人柱力）': 0.006,
  '周总': 0.006,
  '迷人': 0.016
};
const MR_RATE = 0.30;

function calcBreakdown(amount, creator, plan) {
  const cost = (PLAN_INFO[plan] && PLAN_INFO[plan].cost) || 0;
  const feeRate = FEE_RATE[creator] || 0;
  const fee = amount * feeRate;
  const profit = amount - cost - fee;
  const mrCut = profit > 0 ? profit * MR_RATE : 0;
  const myIncome = profit > 0 ? profit * (1 - MR_RATE) : 0;
  return { cost, fee, feeRate, profit, mrCut, myIncome };
}

async function kv(command, ...args) {
  const res = await fetch(`${KV_URL}/${command}/${args.join("/")}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` }
  });
  const data = await res.json();
  return data.result;
}

async function getOrders() {
  const raw = await kv("get", KV_KEY);
  return raw ? JSON.parse(raw) : [];
}

async function saveOrders(orders) {
  await kv("set", KV_KEY, JSON.stringify(orders));
}

// ---- Feishu API helpers ----

async function getFeishuToken() {
  if (_feishuToken && Date.now() < _feishuTokenExp) return _feishuToken;
  if (!FEISHU_APP_ID || !FEISHU_APP_SECRET) {
    console.log("[Feishu] No app credentials, skipping");
    return null;
  }
  try {
    const res = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app_id: FEISHU_APP_ID, app_secret: FEISHU_APP_SECRET })
    });
    const data = await res.json();
    if (data.code !== 0) {
      console.error("[Feishu] Token error:", data.msg);
      return null;
    }
    _feishuToken = data.tenant_access_token;
    _feishuTokenExp = Date.now() + (data.expire - 60) * 1000;
    return _feishuToken;
  } catch (e) {
    console.error("[Feishu] Token fetch failed:", e.message);
    return null;
  }
}

async function feishuRequest(method, path, body) {
  const token = await getFeishuToken();
  if (!token) return null;
  try {
    const opts = {
      method,
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      }
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(`https://open.feishu.cn${path}`, opts);
    const data = await res.json();
    if (data.code !== 0) {
      console.error(`[Feishu] ${method} ${path} error:`, data.msg);
      return null;
    }
    return data;
  } catch (e) {
    console.error(`[Feishu] ${method} ${path} failed:`, e.message);
    return null;
  }
}

// Write a record to Feishu Bitable
async function writeBitableRecord(order) {
  const b = calcBreakdown(order.amount, order.creator, order.plan);
  const record = {
    fields: {
      "开单人": order.creator,
      "手机号": order.phone.startsWith("+") ? order.phone : `+86${order.phone}`,
      "版本": order.plan,
      "金额": order.amount,
      "成本": b.cost,
      "手续费": Math.round(b.fee * 100) / 100,
      "可分配利润": Math.round(b.profit * 100) / 100,
      "迷人30%": Math.round(b.mrCut * 100) / 100,
      "个人70%": Math.round(b.myIncome * 100) / 100,
      "状态": order.status,
      "下单时间": order.createdAt ? new Date(order.createdAt).getTime() : Date.now(),
      "订单ID": order.id
    }
  };

  const result = await feishuRequest(
    "POST",
    `/open-apis/bitable/v1/apps/${FEISHU_BITABLE_TOKEN}/tables/${FEISHU_TABLE_ID}/records`,
    record
  );

  if (result) {
    const recordId = result.data?.records?.[0]?.record_id;
    console.log(`[Feishu] Bitable record created: ${recordId}`);
    return recordId;
  }
  return null;
}

// Update a record in Feishu Bitable by order ID
async function updateBitableRecord(orderId, updates) {
  // First find the record by orderId
  const searchResult = await feishuRequest(
    "POST",
    `/open-apis/bitable/v1/apps/${FEISHU_BITABLE_TOKEN}/tables/${FEISHU_TABLE_ID}/records/search`,
    { filter: { conditions: [{ field_name: "订单ID", operator: "is", value: [orderId] }] } }
  );

  if (!searchResult || !searchResult.data?.items?.length) {
    console.log(`[Feishu] Record not found for orderId: ${orderId}`);
    return false;
  }

  const recordId = searchResult.data.items[0].record_id;
  const result = await feishuRequest(
    "PUT",
    `/open-apis/bitable/v1/apps/${FEISHU_BITABLE_TOKEN}/tables/${FEISHU_TABLE_ID}/records/${recordId}`,
    { fields: updates }
  );

  if (result) {
    console.log(`[Feishu] Bitable record ${recordId} updated`);
    return true;
  }
  return false;
}

// Send a notification card to Feishu group
async function sendGroupNotification(order, action) {
  const b = calcBreakdown(order.amount, order.creator, order.plan);
  const displayName = order.creator;

  let actionText = "";
  let headerColor = "";
  if (action === "draft") {
    actionText = "📝 拟定订单（待确认）";
    headerColor = "orange";
  } else if (action === "created") {
    actionText = "🆕 新订单";
    headerColor = "blue";
  } else if (action === "status_changed") {
    const statusIcon = order.status === "已交付" ? "💰" : order.status === "已收货" ? "✅" : "📦";
    actionText = `${statusIcon} 状态变更为「${order.status}」`;
    headerColor = order.status === "已交付" ? "green" : order.status === "已收货" ? "turquoise" : "orange";
  }

  const card = {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: "plain_text", content: `${actionText} - ${displayName}` },
      template: headerColor
    },
    elements: [
      {
        tag: "div",
        fields: [
          { is_short: true, text: { tag: "lark_md", content: `**版本**\n${order.plan}` } },
          { is_short: true, text: { tag: "lark_md", content: `**金额**\n¥${order.amount}` } },
          { is_short: true, text: { tag: "lark_md", content: `**手机号**\n${order.phone}` } },
          { is_short: true, text: { tag: "lark_md", content: `**状态**\n${order.status}` } }
        ]
      },
      { tag: "hr" },
      {
        tag: "div",
        fields: [
          { is_short: true, text: { tag: "lark_md", content: `**成本**\n¥${b.cost}` } },
          { is_short: true, text: { tag: "lark_md", content: `**手续费**\n¥${b.fee.toFixed(2)}` } },
          { is_short: true, text: { tag: "lark_md", content: `**迷人30%**\n¥${b.mrCut.toFixed(2)}` } },
          { is_short: true, text: { tag: "lark_md", content: `**个人70%**\n¥${b.myIncome.toFixed(2)}` } }
        ]
      }
    ]
  };

  const result = await feishuRequest(
    "POST",
    "/open-apis/im/v1/messages?receive_id_type=chat_id",
    {
      receive_id: FEISHU_CHAT_ID,
      msg_type: "interactive",
      content: JSON.stringify(card)
    }
  );

  if (result) {
    console.log(`[Feishu] Group notification sent for order ${order.id}`);
  }
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    if (req.method === "GET") {
      const orders = await getOrders();
      return res.status(200).json(orders);
    }

    if (req.method === "POST") {
      const { creator, phone, plan, amount, status, remark } = req.body;
      if (!creator || !phone || !plan) {
        return res.status(400).json({ error: "Missing required fields" });
      }
      const isDraft = status === 'draft';
      const orders = await getOrders();
      const order = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        creator,
        phone,
        plan,
        amount: parseFloat(amount) || 0,
        status: isDraft ? "draft" : "未收货",
        createdAt: new Date().toISOString()
      };
      if (remark) order.remark = remark;
      orders.push(order);
      await saveOrders(orders);

      // Sync to Feishu only for non-draft orders
      if (!isDraft) {
        try {
          const recordId = await writeBitableRecord(order);
          if (recordId) {
            const idx = orders.findIndex(o => o.id === order.id);
            if (idx !== -1) {
              orders[idx].feishuRecordId = recordId;
              await saveOrders(orders);
            }
          }
        } catch (e) { console.error("[Feishu] Bitable write error:", e.message); }

        try {
          await sendGroupNotification(order, "created");
        } catch (e) { console.error("[Feishu] Notification error:", e.message); }
      } else {
        // Draft order: send notification only
        try {
          await sendGroupNotification(order, "draft");
        } catch (e) { console.error("[Feishu] Notification error:", e.message); }
      }

      return res.status(201).json(order);
    }

    if (req.method === "PUT") {
      const { id, status, remark } = req.body;
      if (!id || (!status && remark === undefined)) {
        return res.status(400).json({ error: "Missing id or update field" });
      }
      const orders = await getOrders();
      const order = orders.find(o => o.id === id);
      if (!order) return res.status(404).json({ error: "Order not found" });

      const wasDraft = order.status === 'draft';
      if (status) order.status = status;
      if (remark !== undefined) order.remark = remark;
      await saveOrders(orders);

      // If confirming a draft → 未收货, do first-time Feishu sync
      if (wasDraft && status !== 'draft') {
        try {
          const recordId = await writeBitableRecord(order);
          if (recordId) {
            const idx = orders.findIndex(o => o.id === order.id);
            if (idx !== -1) {
              orders[idx].feishuRecordId = recordId;
              await saveOrders(orders);
            }
          }
        } catch (e) { console.error("[Feishu] Bitable write error:", e.message); }

        try {
          await sendGroupNotification(order, "created");
        } catch (e) { console.error("[Feishu] Notification error:", e.message); }
      } else if (!wasDraft) {
        // Normal status change → update Bitable
        try { await updateBitableRecord(id, { "状态": status }); } catch (e) { console.error("[Feishu] Bitable update error:", e.message); }
        try { await sendGroupNotification(order, "status_changed"); } catch (e) { console.error("[Feishu] Notification error:", e.message); }
      }

      return res.status(200).json(order);
    }

    if (req.method === "DELETE") {
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: "Missing id" });
      let orders = await getOrders();
      orders = orders.filter(o => o.id !== id);
      await saveOrders(orders);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
};
