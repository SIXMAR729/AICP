// src/types.ts

export type AICPIntent = 'booking' | 'order' | 'inquiry';
export type FieldType = 'text' | 'tel' | 'number' | 'date' | 'boolean' | 'email';

export interface AICPFieldDefinition {
  type: FieldType;
  description: string; // Context for the AI Agent (e.g., "Ask for delivery instructions")
  required?: boolean;
  pattern?: string;    // Regex pattern for strict validation (e.g., phone format)
  min?: number;        // Minimum threshold for numeric fields
  max?: number;        // Maximum threshold for numeric fields
}

export interface AICPOrderSchema {
  version: string;
  intent: AICPIntent;
  ai_prompt: string;   // System prompt to instruct AI behavior
  workflow: string[];
  required: string[];
  fields: Record<string, AICPFieldDefinition>;
}

export interface AICPOrderPayload {
  store_id: string;
  idempotency_key: string;
  answers: Record<string, any>; // The extracted entities/data submitted by the AI
}
