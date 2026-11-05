// src/validator.ts
import { AICPOrderSchema, AICPOrderPayload } from './types';

export interface ValidationResult {
  isValid: boolean;
  errors: Array<{ field: string; message: string }>;
}

export interface AICPJsonSchemaProperty {
  type: 'string' | 'number' | 'boolean';
  description: string;
  pattern?: string;
  format?: 'email' | 'date';
  minimum?: number;
  maximum?: number;
}

export interface AICPJsonSchema {
  type: 'object';
  description?: string;
  properties: Record<string, AICPJsonSchemaProperty>;
  required: string[];
  additionalProperties: boolean;
}

/**
 * Converts an AICPOrderSchema into a standard JSON Schema object suitable for
 * MCP tool `inputSchema` or LLM function-calling parameters (OpenAI, Claude, Gemini).
 */
export function toJsonSchema(schema: AICPOrderSchema): AICPJsonSchema {
  const properties: Record<string, AICPJsonSchemaProperty> = {};
  const requiredSet = new Set<string>(schema.required);

  for (const [key, field] of Object.entries(schema.fields)) {
    if (field.required) requiredSet.add(key);

    if (field.type === 'number') {
      const prop: AICPJsonSchemaProperty = { type: 'number', description: field.description };
      if (field.min !== undefined) prop.minimum = field.min;
      if (field.max !== undefined) prop.maximum = field.max;
      properties[key] = prop;
    } else if (field.type === 'boolean') {
      properties[key] = { type: 'boolean', description: field.description };
    } else {
      const prop: AICPJsonSchemaProperty = { type: 'string', description: field.description };
      if (field.pattern !== undefined) prop.pattern = field.pattern;
      if (field.type === 'email') prop.format = 'email';
      else if (field.type === 'date') prop.format = 'date';
      properties[key] = prop;
    }
  }

  return {
    type: 'object',
    ...(schema.ai_prompt ? { description: schema.ai_prompt } : {}),
    properties,
    required: Array.from(requiredSet),
    additionalProperties: false,
  };
}

export function validateAICPAnswers(schema: AICPOrderSchema, payload: AICPOrderPayload): ValidationResult {
  const errors: Array<{ field: string; message: string }> = [];
  const { answers } = payload;

  // 1. Validate Required Fields
  for (const reqField of schema.required) {
    if (answers[reqField] === undefined || answers[reqField] === null || answers[reqField] === '') {
      errors.push({ field: reqField, message: `Missing required field: ${reqField}` });
    }
  }

  // 2. Validate Formats, Regex Patterns, and Bounds
  for (const [key, value] of Object.entries(answers)) {
    const fieldDef = schema.fields[key];
    if (!fieldDef) continue; // Skip arbitrary fields not defined in the schema

    // Regex Pattern Matching (e.g., Phone numbers, Zip codes)
    if (fieldDef.pattern && typeof value === 'string') {
      const regex = new RegExp(fieldDef.pattern);
      if (!regex.test(value)) {
        errors.push({ field: key, message: `Invalid format for field: ${key}. Expected pattern: ${fieldDef.pattern}` });
      }
    }

    // Numeric Bounds (Min / Max)
    if (fieldDef.type === 'number' && typeof value === 'number') {
      if (fieldDef.min !== undefined && value < fieldDef.min) {
        errors.push({ field: key, message: `${key} must be at least ${fieldDef.min}` });
      }
      if (fieldDef.max !== undefined && value > fieldDef.max) {
        errors.push({ field: key, message: `${key} must be at most ${fieldDef.max}` });
      }
    }
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}
