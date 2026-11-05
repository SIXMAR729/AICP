// examples/delivery-escalation.ts — delivery is confirmed by the BUYER, never by the agent (§5.5).
import { AICPClient } from '@aicp/core';

export async function offerDelivery(client: AICPClient, storeId: string, itemId: string, address: string) {
  const draft = await client.prepareDelivery(storeId, { items: [{ id: itemId, quantity: 1 }], delivery_address: address });
  if (draft.status !== 'requires_escalation' || !draft.continue_url) throw new Error('Unexpected prepare result');
  // Show the platform's numbers, then hand over the link.
  return `Subtotal ฿${draft.subtotal} + delivery ฿${draft.delivery_fee} = ฿${draft.total}. ` +
         `Please confirm here (expires ${new Date(draft.expires_at * 1000).toLocaleString()}): ${draft.continue_url}`;
}
