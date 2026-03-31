export default async function handler(req, res) {
  const EVENTBRITE_TOKEN = process.env.EVENTBRITE_TOKEN;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET — check if email is booked for an event
  if (req.method === 'GET') {
    const { event_id, email } = req.query;
    if (!event_id || !email) return res.status(400).json({ error: 'Missing event_id or email' });

    try {
      // Use orders endpoint with email filter — more reliable than attendees search
      const ordersRes = await fetch(
        `https://www.eventbriteapi.com/v3/events/${event_id}/orders/?only_emails[]=${encodeURIComponent(email)}&status=placed`,
        { headers: { Authorization: `Bearer ${EVENTBRITE_TOKEN}` } }
      );
      const ordersData = await ordersRes.json();
      if (!ordersRes.ok) return res.status(ordersRes.status).json({ error: ordersData.error_description || 'Eventbrite API error' });

      const orders = ordersData.orders || [];
      const match = orders.find(o => o.email?.toLowerCase() === email.toLowerCase());
      if (match) return res.status(200).json({ booked: true, order_id: match.id });

      // Fallback: attendees search
      const attRes = await fetch(
        `https://www.eventbriteapi.com/v3/events/${event_id}/attendees/?search=${encodeURIComponent(email)}&expand=order`,
        { headers: { Authorization: `Bearer ${EVENTBRITE_TOKEN}` } }
      );
      const attData = await attRes.json();
      const attendees = (attData.attendees || []).filter(a => a.cancelled === false);
      const att = attendees.find(a => a.profile?.email?.toLowerCase() === email.toLowerCase());
      if (!att) return res.status(200).json({ booked: false });
      const orderId = att.order_id || att.order?.id;
      return res.status(200).json(orderId ? { booked: true, order_id: orderId } : { booked: false, debug: 'attendee found but no order_id' });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to check booking' });
    }
  }

  // POST — cancel a booking
  if (req.method === 'POST') {
    const { order_id, email } = req.body || {};
    if (!order_id || !email) return res.status(400).json({ error: 'Missing order_id or email' });

    try {
      const orderRes = await fetch(
        `https://www.eventbriteapi.com/v3/orders/${order_id}/`,
        { headers: { Authorization: `Bearer ${EVENTBRITE_TOKEN}` } }
      );
      const order = await orderRes.json();
      if (!orderRes.ok) return res.status(orderRes.status).json({ error: order.error_description || 'Could not fetch order' });

      if (order.email?.toLowerCase() !== email.toLowerCase()) {
        return res.status(403).json({ error: 'Email does not match order' });
      }

      const cancelRes = await fetch(
        `https://www.eventbriteapi.com/v3/orders/${order_id}/cancel/`,
        { method: 'POST', headers: { Authorization: `Bearer ${EVENTBRITE_TOKEN}` } }
      );
      const cancelData = await cancelRes.json();
      if (!cancelRes.ok) return res.status(cancelRes.status).json({ error: cancelData.error_description || 'Failed to cancel' });

      return res.status(200).json({ cancelled: true });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to cancel booking' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
