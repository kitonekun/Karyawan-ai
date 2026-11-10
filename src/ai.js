// Integrasi AI opsional (API kompatibel OpenAI). Tanpa AI_API_KEY aplikasi memakai jawaban berbasis aturan.
const KEY = process.env.AI_API_KEY;
const BASE = (process.env.AI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
const MODEL = process.env.AI_MODEL || 'gpt-4o-mini';

export const aiEnabled = () => Boolean(KEY);

export async function chatAI(system, history, userText) {
  if (!KEY) return null;
  const messages = [
    { role: 'system', content: system },
    ...history.slice(-10).map((m) => ({ role: m.from === 'user' ? 'user' : 'assistant', content: m.text })),
    { role: 'user', content: userText },
  ];
  try {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
      body: JSON.stringify({ model: MODEL, messages, temperature: 0.4 }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim() || null;
  } catch (err) {
    console.error('AI gagal, memakai jawaban bawaan:', err.message);
    return null;
  }
}
