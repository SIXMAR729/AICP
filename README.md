# 🤖 AICP Core (AI Commerce Protocol)

The open standard for Agentic E-Commerce. `@aicp/core` provides the foundational TypeScript types and schema validators to allow external AI Agents (ChatGPT, Gemini, Claude, Copilot) to dynamically discover your store capabilities and place orders using a **Schema-as-a-Contract** architecture.

## Installation

```bash
npm install @aicp/core
```

## Usage Example

### 1. Define your Store's Schema (Layer 2)

```typescript
import { AICPOrderSchema } from '@aicp/core';

const bikeRentalSchema: AICPOrderSchema = {
  version: "1.0",
  intent: "booking",
  ai_prompt: "Ask customer for rental details one by one. Be polite and concise.",
  workflow: ["collect_info", "confirm", "payment"],
  required: ["customer_name", "phone", "days"],
  fields: {
    customer_name: { type: "text", description: "Name of the renter" },
    phone: { type: "tel", description: "10-digit phone number", pattern: "^0[0-9]{9}$" },
    days: { type: "number", description: "Number of days to rent", min: 1, max: 30 }
  }
};
```

### 2. Validate Incoming AI Orders (Layer 3)

```typescript
import { validateAICPAnswers } from '@aicp/core';

// Inside your POST /orders API Route Handler
const aiPayload = {
  store_id: "store-123",
  idempotency_key: "req-abc-456",
  answers: {
    customer_name: "John Doe",
    phone: "0812345678",
    days: 0 // This will fail validation (min: 1)
  }
};

const result = validateAICPAnswers(bikeRentalSchema, aiPayload);

if (!result.isValid) {
  // Return 400 Bad Request back to the AI Agent so it can self-correct and re-prompt the user
  console.log(result.errors); 
  // Output: [ { field: 'days', message: 'days must be at least 1' } ]
}
```
