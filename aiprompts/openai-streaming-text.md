For **just text streaming**, you only need to handle these 3 core events:

## Essential Events

### 1. `response.created`

```json
{
  "type": "response.created",
  "response": {
    "id": "resp_abc123",
    "created_at": 1640995200,
    "model": "gpt-5"
  }
}
```

**Purpose**: Initialize response tracking (like Anthropic's `message_start`)

### 2. `response.output_text.delta`

```json
{
  "type": "response.output_text.delta",
  "item_id": "msg_abc123",
  "delta": "Hello, how can I"
}
```

**Purpose**: Stream text chunks (like Anthropic's `text_delta`)

### 3. `response.completed`

```json
{
  "type": "response.completed",
  "response": {
    "usage": {
      "input_tokens": 100,
      "output_tokens": 200
    }
  }
}
```

**Purpose**: Finalize response (like Anthropic's `message_stop`)

## Optional but Recommended

### 4. `error`

```json
{
  "type": "error",
  "code": "rate_limit_exceeded",
  "message": "Rate limit exceeded"
}
```

**Purpose**: Handle errors gracefully

---

That's it for basic text streaming! You can ignore all the `response.output_item.added/done`, tool calling, reasoning, and annotation events if you just want simple text responses.

Your Go implementation would be:

1. Parse SSE stream
2. Switch on `event.type`
3. Handle these 4 event types
4. Accumulate text from `delta` fields
5. Emit to your existing SSE handler

Much simpler than the full implementation.
