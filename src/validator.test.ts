import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateAICPAnswers, toJsonSchema } from './validator';
import { AICPOrderSchema, AICPOrderPayload } from './types';

describe('validateAICPAnswers', () => {
  const sampleSchema: AICPOrderSchema = {
    version: '1.0',
    intent: 'booking',
    ai_prompt: 'Collect booking details politely.',
    workflow: ['collect_info', 'confirm', 'payment'],
    required: ['customer_name', 'phone', 'days'],
    fields: {
      customer_name: {
        type: 'text',
        description: 'Name of the customer',
      },
      phone: {
        type: 'tel',
        description: '10-digit phone number starting with 0',
        pattern: '^0[0-9]{9}$',
      },
      days: {
        type: 'number',
        description: 'Number of rental days',
        min: 1,
        max: 30,
      },
    },
  };

  it('should return isValid: true for a complete and valid payload', () => {
    const payload: AICPOrderPayload = {
      store_id: 'store-123',
      idempotency_key: 'req-abc-123',
      answers: {
        customer_name: 'John Doe',
        phone: '0812345678',
        days: 5,
      },
    };

    const result = validateAICPAnswers(sampleSchema, payload);
    assert.equal(result.isValid, true);
    assert.equal(result.errors.length, 0);
  });

  it('should return errors when required fields are missing', () => {
    const payload: AICPOrderPayload = {
      store_id: 'store-123',
      idempotency_key: 'req-abc-124',
      answers: {
        days: 3,
        // customer_name and phone missing
      },
    };

    const result = validateAICPAnswers(sampleSchema, payload);
    assert.equal(result.isValid, false);
    assert.deepEqual(result.errors, [
      { field: 'customer_name', message: 'Missing required field: customer_name' },
      { field: 'phone', message: 'Missing required field: phone' },
    ]);
  });

  it('should return error when required field is empty string or null', () => {
    const payload: AICPOrderPayload = {
      store_id: 'store-123',
      idempotency_key: 'req-abc-125',
      answers: {
        customer_name: '',
        phone: '0812345678',
        days: 2,
      },
    };

    const result = validateAICPAnswers(sampleSchema, payload);
    assert.equal(result.isValid, false);
    assert.deepEqual(result.errors, [
      { field: 'customer_name', message: 'Missing required field: customer_name' },
    ]);
  });

  it('should validate pattern regex matching correctly', () => {
    const payload: AICPOrderPayload = {
      store_id: 'store-123',
      idempotency_key: 'req-abc-126',
      answers: {
        customer_name: 'Jane Doe',
        phone: '123456', // Invalid format
        days: 5,
      },
    };

    const result = validateAICPAnswers(sampleSchema, payload);
    assert.equal(result.isValid, false);
    assert.deepEqual(result.errors, [
      { field: 'phone', message: 'Invalid format for field: phone. Expected pattern: ^0[0-9]{9}$' },
    ]);
  });

  it('should enforce numeric min bounds', () => {
    const payload: AICPOrderPayload = {
      store_id: 'store-123',
      idempotency_key: 'req-abc-127',
      answers: {
        customer_name: 'Alice',
        phone: '0987654321',
        days: 0, // Min is 1
      },
    };

    const result = validateAICPAnswers(sampleSchema, payload);
    assert.equal(result.isValid, false);
    assert.deepEqual(result.errors, [
      { field: 'days', message: 'days must be at least 1' },
    ]);
  });

  it('should enforce numeric max bounds', () => {
    const payload: AICPOrderPayload = {
      store_id: 'store-123',
      idempotency_key: 'req-abc-128',
      answers: {
        customer_name: 'Bob',
        phone: '0987654321',
        days: 45, // Max is 30
      },
    };

    const result = validateAICPAnswers(sampleSchema, payload);
    assert.equal(result.isValid, false);
    assert.deepEqual(result.errors, [
      { field: 'days', message: 'days must be at most 30' },
    ]);
  });

  it('should ignore extra fields not defined in schema', () => {
    const payload: AICPOrderPayload = {
      store_id: 'store-123',
      idempotency_key: 'req-abc-129',
      answers: {
        customer_name: 'Charlie',
        phone: '0811223344',
        days: 3,
        extra_note: 'Please deliver to front door',
      },
    };

    const result = validateAICPAnswers(sampleSchema, payload);
    assert.equal(result.isValid, true);
    assert.equal(result.errors.length, 0);
  });

  it('should convert AICPOrderSchema to standard JSON Schema for MCP / LLM function calling', () => {
    const jsonSchema = toJsonSchema({
      ...sampleSchema,
      fields: {
        ...sampleSchema.fields,
        email: { type: 'email', description: 'Contact email', required: true },
        agree_terms: { type: 'boolean', description: 'Accept rental terms' },
      },
    });

    assert.deepEqual(jsonSchema, {
      type: 'object',
      description: 'Collect booking details politely.',
      properties: {
        customer_name: { type: 'string', description: 'Name of the customer' },
        phone: {
          type: 'string',
          description: '10-digit phone number starting with 0',
          pattern: '^0[0-9]{9}$',
        },
        days: {
          type: 'number',
          description: 'Number of rental days',
          minimum: 1,
          maximum: 30,
        },
        email: {
          type: 'string',
          description: 'Contact email',
          format: 'email',
        },
        agree_terms: {
          type: 'boolean',
          description: 'Accept rental terms',
        },
      },
      required: ['customer_name', 'phone', 'days', 'email'],
      additionalProperties: false,
    });
  });
});
