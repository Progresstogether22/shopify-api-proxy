export default async function handler(req, res) {
  const EVENTBRITE_TOKEN = process.env.EVENTBRITE_TOKEN;

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { order_id, email } = req.body || {};

  if (!order_id || !email) return res.status(400).json({ error: "Missing order_id or email" });

  try {
    // Verify the order belongs to this email before cancelling
    const orderRes = await fetch(
      `https://www.eventbriteapi.com/v3/orders/${order_id}/`,
      { headers: { Authorization: `Bearer ${EVENTBRITE_TOKEN}` } }
    );
    const order = await orderRes.json();
    if (!orderRes.ok) return res.status(orderRes.status).json({ error: order.error_description || "Could not fetch order" });

    if (!order.email || order.email.toLowerCase() !== email.toLowerCase()) {
      return res.status(403).json({ error: "Email does not match order" });
    }

    // Cancel the order
    const cancelRes = await fetch(
      `https://www.eventbriteapi.com/v3/orders/${order_id}/cancel/`,
      { method: "POST", headers: { Authorization: `Bearer ${EVENTBRITE_TOKEN}` } }
    );
    const cancelData = await cancelRes.json();
    if (!cancelRes.ok) return res.status(cancelRes.status).json({ error: cancelData.error_description || "Failed to cancel" });

    res.status(200).json({ cancelled: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to cancel booking" });
  }
}
