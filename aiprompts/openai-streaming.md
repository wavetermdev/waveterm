# OpenAI Responses API SSE Events Documentation

This document outlines the Server-Sent Events (SSE) format used by OpenAI's Responses API for streaming chat completions, based on the Vercel AI SDK implementation.

## Core Event Types

### Response Lifecycle Events

#### `response.created`

Emitted when a new response begins.

```json
{
  "type": "response.created",
  "response": {
    "id": "resp_abc123",
    "created_at": 1640995200,
    "model": "gpt-5",
    "service_tier": "default"
  }
}
```

#### `response.completed`

Emitted when the response completes successfully.

```json
{
  "type": "response.completed",
  "response": {
    "incomplete_details": null,
    "usage": {
      "input_tokens": 100,
      "input_tokens_details": {
        "cached_tokens": 50
      },
      "output_tokens": 200,
      "output_tokens_details": {
        "reasoning_tokens": 150
      }
    },
    "service_tier": "default"
  }
}
```

#### `response.incomplete`

Emitted when the response is incomplete (e.g., due to length limits).

```json
{
  "type": "response.incomplete",
  "response": {
    "incomplete_details": {
      "reason": "max_tokens"
    },
    "usage": {
      "input_tokens": 100,
      "output_tokens": 4000
    }
  }
}
```

### Content Block Events

#### `response.output_item.added`

Emitted when a new output item (content block) is added.

```json
{
  "type": "response.output_item.added",
  "output_index": 0,
  "item": {
    "type": "message",
    "id": "msg_abc123"
  }
}
```

Item types can be:

- `message` - Text content
- `reasoning` - Reasoning/thinking content
- `function_call` - Tool call
- `web_search_call` - Web search tool call
- `computer_call` - Computer use tool call
- `file_search_call` - File search tool call
- `image_generation_call` - Image generation tool call
- `code_interpreter_call` - Code interpreter tool call

#### `response.output_item.done`

Emitted when an output item is completed.

```json
{
  "type": "response.output_item.done",
  "output_index": 0,
  "item": {
    "type": "message",
    "id": "msg_abc123"
  }
}
```

For function calls, includes the complete arguments:

```json
{
  "type": "response.output_item.done",
  "output_index": 1,
  "item": {
    "type": "function_call",
    "id": "call_abc123",
    "call_id": "call_abc123",
    "name": "get_weather",
    "arguments": "{\"location\": \"San Francisco\"}",
    "status": "completed"
  }
}
```

### Text Streaming Events

#### `response.output_text.delta`

Emitted for incremental text content.

```json
{
  "type": "response.output_text.delta",
  "item_id": "msg_abc123",
  "delta": "Hello, how can I",
  "logprobs": [
    {
      "token": "Hello",
      "logprob": -0.1,
      "top_logprobs": [
        {
          "token": "Hello",
          "logprob": -0.1
        },
        {
          "token": "Hi",
          "logprob": -2.3
        }
      ]
    }
  ]
}
```

### Tool Call Events

#### `response.function_call_arguments.delta`

Emitted for streaming function call arguments.

```json
{
  "type": "response.function_call_arguments.delta",
  "item_id": "call_abc123",
  "output_index": 1,
  "delta": "\"location\": \"San"
}
```

### Reasoning Events

#### `response.reasoning_summary_part.added`

Emitted when a new reasoning summary part is added.

```json
{
  "type": "response.reasoning_summary_part.added",
  "item_id": "reasoning_abc123",
  "summary_index": 0
}
```

#### `response.reasoning_summary_text.delta`

Emitted for incremental reasoning text.

```json
{
  "type": "response.reasoning_summary_text.delta",
  "item_id": "reasoning_abc123",
  "summary_index": 0,
  "delta": "Let me think about this step by step..."
}
```

### Annotation Events

#### `response.output_text.annotation.added`

Emitted when citations or annotations are added to text.

```json
{
  "type": "response.output_text.annotation.added",
  "annotation": {
    "type": "url_citation",
    "url": "https://example.com/article",
    "title": "Example Article"
  }
}
```

Or for file citations:

```json
{
  "type": "response.output_text.annotation.added",
  "annotation": {
    "type": "file_citation",
    "file_id": "file_abc123",
    "filename": "document.pdf",
    "quote": "This is the relevant quote",
    "start_index": 100,
    "end_index": 150
  }
}
```

### Error Events

#### `error`

Emitted when an error occurs.

```json
{
  "type": "error",
  "code": "rate_limit_exceeded",
  "message": "Rate limit exceeded. Please try again later.",
  "param": null,
  "sequence_number": 5
}
```

## Built-in Tool Call Schemas

### Web Search Call

```json
{
  "type": "web_search_call",
  "id": "search_abc123",
  "status": "completed",
  "action": {
    "type": "search",
    "query": "OpenAI API documentation"
  }
}
```

### File Search Call

```json
{
  "type": "file_search_call",
  "id": "search_abc123",
  "queries": ["OpenAI pricing", "API limits"],
  "results": [
    {
      "attributes": {},
      "file_id": "file_abc123",
      "filename": "pricing.pdf",
      "score": 0.85,
      "text": "OpenAI API pricing starts at..."
    }
  ]
}
```

### Code Interpreter Call

```json
{
  "type": "code_interpreter_call",
  "id": "code_abc123",
  "code": "print('Hello, world!')",
  "container_id": "container_123",
  "outputs": [
    {
      "type": "logs",
      "logs": "Hello, world!\n"
    }
  ]
}
```

### Image Generation Call

```json
{
  "type": "image_generation_call",
  "id": "img_abc123",
  "result": "https://example.com/generated-image.png"
}
```

### Computer Use Call

```json
{
  "type": "computer_call",
  "id": "computer_abc123",
  "status": "completed"
}
```

## Event Processing Flow

1. **Response Start**: `response.created` → Initialize response tracking
2. **Content Blocks**: `response.output_item.added` → Start tracking content block
3. **Streaming Content**:
   - `response.output_text.delta` → Accumulate text
   - `response.function_call_arguments.delta` → Accumulate tool arguments
   - `response.reasoning_summary_text.delta` → Accumulate reasoning
4. **Content Complete**: `response.output_item.done` → Finalize content block
5. **Response End**: `response.completed`/`response.incomplete` → Finalize response

## Key Differences from Anthropic

| Aspect         | OpenAI Responses API                     | Anthropic Messages API                           |
| -------------- | ---------------------------------------- | ------------------------------------------------ |
| Text streaming | `response.output_text.delta`             | `content_block_delta` (type: `text_delta`)       |
| Tool arguments | `response.function_call_arguments.delta` | `content_block_delta` (type: `input_json_delta`) |
| Reasoning      | `response.reasoning_summary_text.delta`  | `content_block_delta` (type: `thinking_delta`)   |
| Block tracking | `output_index`                           | `index`                                          |
| Response start | `response.created`                       | `message_start`                                  |
| Response end   | `response.completed`                     | `message_stop`                                   |

## Error Handling

- Parse each SSE event with proper JSON validation
- Handle unknown event types gracefully (forward as-is or ignore)
- Track `sequence_number` for error events to maintain order
- Use `output_index` to correlate events with specific content blocks
- Handle partial JSON in tool argument deltas (accumulate until complete)

## Implementation Notes

- Events may arrive out of order; use `output_index` and `item_id` for correlation
- Multiple reasoning summary parts can exist; track by `summary_index`
- Tool calls can be provider-executed (built-in tools) or require client execution
- Logprobs are optional and only included when requested
- Usage tokens are only available in completion events
