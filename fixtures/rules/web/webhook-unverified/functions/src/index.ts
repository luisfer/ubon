import * as admin from 'firebase-admin';
import { onRequest } from 'firebase-functions/v2/https';

admin.initializeApp();

export const stripeWebhook = onRequest(async (req, res) => {
  const event = req.body; // expect-block: web/webhook-unverified
  await admin.firestore().collection('orders').doc(event.data.object.id).set({ paid: true });
  res.send('ok');
});
