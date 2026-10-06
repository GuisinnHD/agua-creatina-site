// Função serverless da Vercel: guarda o histórico no Upstash Redis (Marketplace da Vercel).
const crypto = require("crypto");

// APP_SENHA aceita vários códigos separados por vírgula: um por pessoa.
// O 1º código (o seu) usa as chaves antigas; cada um dos outros tem a sua própria área no banco.
const CODIGOS = (process.env.APP_SENHA || "").split(",").map((s) => s.trim()).filter(Boolean);
function prefixoDe(codigo) {
  const i = CODIGOS.indexOf(codigo);
  if (i < 0) return null;
  return i === 0 ? "agua" : "agua:" + crypto.createHash("sha256").update(codigo).digest("hex").slice(0, 16);
}

const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

async function redis(cmd) {
  const r = await fetch(URL_, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(cmd)
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j.result;
}

// HGETALL volta como lista [campo, valor, campo, valor...] (ou já como objeto)
function pares(res, converter) {
  const out = {};
  if (Array.isArray(res)) for (let i = 0; i < res.length; i += 2) out[res[i]] = converter(res[i + 1]);
  else if (res && typeof res === "object") for (const k of Object.keys(res)) out[k] = converter(res[k]);
  return out;
}
const lerJSON = (s) => { try { return typeof s === "string" ? JSON.parse(s) : s; } catch { return null; } };

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!CODIGOS.length || !URL_ || !TOKEN) return res.status(500).json({ erro: "Servidor sem configuração (APP_SENHA ou banco)" });
  const p = prefixoDe(String(req.headers["x-senha"] || ""));
  if (!p) return res.status(401).json({ erro: "Código incorreto" });

  try {
    if (req.method === "GET") {
      const [dias, cfg] = await Promise.all([redis(["HGETALL", p + ":dias"]), redis(["HGETALL", p + ":cfg"])]);
      return res.status(200).json({ dias: pares(dias, lerJSON), cfg: pares(cfg, Number) });
    }

    if (req.method === "POST") {
      const b = req.body || {};

      if (b.tipo === "dia") {
        const v = b.valor || {};
        const okData = /^\d{4}-\d{2}-\d{2}$/.test(b.data || "");
        const okA = Array.isArray(v.a) && v.a.length <= 200 && v.a.every((n) => Number.isInteger(n) && n > 0 && n <= 5000);
        if (!okData || !okA || typeof v.c !== "boolean") return res.status(400).json({ erro: "Dados inválidos" });
        await redis(["HSET", p + ":dias", b.data, JSON.stringify({ a: v.a, c: v.c, t: Number(v.t) || Date.now() })]);
        return res.status(200).json({ ok: true });
      }

      if (b.tipo === "cfg") {
        const meta = Number(b.meta), dose = Number(b.dose);
        if (!(meta >= 500 && meta <= 20000) || !(dose > 0 && dose <= 100)) return res.status(400).json({ erro: "Dados inválidos" });
        await redis(["HSET", p + ":cfg", "meta", meta, "dose", dose, "t", Number(b.t) || Date.now()]);
        return res.status(200).json({ ok: true });
      }

      return res.status(400).json({ erro: "Tipo desconhecido" });
    }

    return res.status(405).json({ erro: "Método não permitido" });
  } catch (e) {
    return res.status(500).json({ erro: "Falha no banco de dados" });
  }
};
