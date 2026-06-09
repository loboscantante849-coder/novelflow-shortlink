const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const KV_VISITS_KEY = "nf_coze_visits";

async function kv(command, ...args) {
  const res = await fetch(`${KV_URL}/${command}/${args.join("/")}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` }
  });
  const data = await res.json();
  return data.result;
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const raw = await kv("get", KV_VISITS_KEY);
    const visits = raw ? JSON.parse(raw) : [];
    return res.status(200).json(visits);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
