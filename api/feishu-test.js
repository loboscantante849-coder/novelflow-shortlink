module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  const APP_ID = process.env.FEISHU_APP_ID;
  const APP_SECRET = process.env.FEISHU_APP_SECRET;
  
  const debug = {
    hasAppId: !!APP_ID,
    hasAppSecret: !!APP_SECRET,
    appIdLength: APP_ID ? APP_ID.length : 0,
    appSecretLength: APP_SECRET ? APP_SECRET.length : 0,
    appIdPrefix: APP_ID ? APP_ID.substring(0, 5) : "none"
  };

  // Test token fetch
  let tokenResult = null;
  if (APP_ID && APP_SECRET) {
    try {
      const tr = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ app_id: APP_ID, app_secret: APP_SECRET })
      });
      tokenResult = await tr.json();
    } catch (e) {
      tokenResult = { error: e.message };
    }
  }

  // Test bitable write
  let writeResult = null;
  if (tokenResult && tokenResult.code === 0) {
    try {
      const wr = await fetch("https://open.feishu.cn/open-apis/bitable/v1/apps/H0dlbqN5qageHQscTTEc9aqKnmc/tables/tbllSBgcrMDvJtDk/records", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${tokenResult.tenant_access_token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          fields: {
            "开单人": "迷人",
            "手机号": "debug-test",
            "版本": "个人高阶版",
            "金额": 1,
            "成本": 1,
            "手续费": 0.01,
            "可分配利润": 0,
            "迷人30%": 0,
            "个人70%": 0,
            "状态": "未收货",
            "订单ID": "debug-test-001"
          }
        })
      });
      writeResult = await wr.json();
    } catch (e) {
      writeResult = { error: e.message };
    }
  }

  res.status(200).json({ debug, tokenResult: { code: tokenResult?.code, msg: tokenResult?.msg, hasToken: !!tokenResult?.tenant_access_token }, writeResult });
};
