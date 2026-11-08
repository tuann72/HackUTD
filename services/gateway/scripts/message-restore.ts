// "Not a scam": move one blocked message to the inbox (reason `override`).
// With SENDER_BLOCKLIST=on, the gateway also allowlists that message's sender.
// Usage: npm run message:restore -- <message id>      (the msg_... id shown by GET /api/messages)
// Env: GATEWAY_URL (default http://localhost:$PORT), ADMIN_TOKEN (must match the gateway's).
const messageId = process.argv[2];
if (!messageId || !/^msg_[0-9a-zA-Z]+$/.test(messageId)) {
  console.error('usage: npm run message:restore -- <message id, e.g. msg_0123abcd...>');
  process.exit(2);
}
const token = process.env.ADMIN_TOKEN?.trim();
if (!token) {
  console.error('ADMIN_TOKEN is not set (in .env or the environment). It must match the gateway.');
  process.exit(2);
}
const base = (process.env.GATEWAY_URL?.trim() || `http://localhost:${process.env.PORT?.trim() || '8787'}`).replace(/\/+$/, '');
const res = await fetch(`${base}/admin/messages/restore`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Admin-Token': token },
  body: JSON.stringify({ messageId }),
});
console.log(`POST ${base}/admin/messages/restore -> ${res.status}`);
console.log(await res.text());
process.exit(res.ok ? 0 : 1);
