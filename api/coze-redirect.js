const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const KV_VISITS_KEY = "nf_coze_visits";
const TARGET_URL = "https://code.coze.cn/subscription-paywall?dist_channel=10002&distributor_id=20024";

async function kv(command, ...args) {
  const res = await fetch(`${KV_URL}/${command}/${args.join("/")}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` }
  });
  const data = await res.json();
  return data.result;
}

module.exports = async function handler(req, res) {
  // Log the visit
  try {
    const visit = {
      ip: req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.connection?.remoteAddress || 'unknown',
      ua: req.headers['user-agent'] || '',
      referer: req.headers['referer'] || '',
      lang: req.headers['accept-language'] || '',
      time: new Date().toISOString()
    };
    
    // Get existing visits, append, save (keep last 500)
    const raw = await kv("get", KV_VISITS_KEY);
    let visits = raw ? JSON.parse(raw) : [];
    visits.push(visit);
    if (visits.length > 500) visits = visits.slice(-500);
    await kv("set", KV_VISITS_KEY, JSON.stringify(visits));
  } catch (e) {
    // Log failure shouldn't block redirect
    console.error("Log visit error:", e.message);
  }

  // Redirect to target
  res.writeHead(302, { Location: TARGET_URL });
  res.end();
};
