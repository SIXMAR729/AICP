// src/validator.ts
import { AICPOrderSchema, AICPOrderPayload } from './types';

export interface ValidationResult {
  isValid: boolean;
  errors: Array<{ field: string; message: string }>;
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
