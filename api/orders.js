const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const KV_KEY = "nf_orders";

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

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    if (req.method === "GET") {
      const orders = await getOrders();
      return res.status(200).json(orders);
    }

    if (req.method === "POST") {
      const { creator, phone, plan, amount } = req.body;
      if (!creator || !phone || !plan || !amount) {
        return res.status(400).json({ error: "Missing required fields" });
      }
      const orders = await getOrders();
      const order = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        creator,
        phone,
        plan,
        amount: parseFloat(amount),
        status: "未收货",
        createdAt: new Date().toISOString()
      };
      orders.push(order);
      await saveOrders(orders);
      return res.status(201).json(order);
    }

    if (req.method === "PUT") {
      const { id, status } = req.body;
      if (!id || !status) {
        return res.status(400).json({ error: "Missing id or status" });
      }
      const orders = await getOrders();
      const order = orders.find(o => o.id === id);
      if (!order) return res.status(404).json({ error: "Order not found" });
      order.status = status;
      await saveOrders(orders);
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
