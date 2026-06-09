const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO = "loboscantante849-coder/novelflow-shortlink";
const FILE_PATH = "orders.json";
const API = `https://api.github.com/repos/${REPO}/contents/${FILE_PATH}`;

async function getOrders() {
  const res = await fetch(`${API}?ref=main`, {
    headers: { Authorization: `token ${GITHUB_TOKEN}`, Accept: "application/vnd.github.v3+json" }
  });
  if (res.status === 404) return { orders: [], sha: null };
  const data = await res.json();
  const orders = JSON.parse(Buffer.from(data.content, "base64").toString());
  return { orders, sha: data.sha };
}

async function saveOrders(orders, sha) {
  const content = Buffer.from(JSON.stringify(orders, null, 2)).toString("base64");
  const body = { message: "Update orders", content, branch: "main" };
  if (sha) body.sha = sha;
  const res = await fetch(API, {
    method: "PUT",
    headers: { Authorization: `token ${GITHUB_TOKEN}`, Accept: "application/vnd.github.v3+json", "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(`GitHub save failed: ${err.message}`);
  }
  return res.json();
}

module.exports = async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const { orders, sha } = await getOrders();

    if (req.method === "GET") {
      return res.status(200).json(orders);
    }

    if (req.method === "POST") {
      // Add new order
      const { creator, phone, plan, amount } = req.body;
      if (!creator || !phone || !plan || !amount) {
        return res.status(400).json({ error: "Missing required fields" });
      }
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
      await saveOrders(orders, sha);
      return res.status(201).json(order);
    }

    if (req.method === "PUT") {
      // Update order status
      const { id, status } = req.body;
      if (!id || !status) {
        return res.status(400).json({ error: "Missing id or status" });
      }
      const order = orders.find(o => o.id === id);
      if (!order) return res.status(404).json({ error: "Order not found" });
      order.status = status;
      await saveOrders(orders, sha);
      return res.status(200).json(order);
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
};
