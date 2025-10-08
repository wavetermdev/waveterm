## Data Stream Protocol

A data stream follows a special protocol that the AI SDK provides to send information to the frontend.

The data stream protocol uses Server-Sent Events (SSE) format for improved standardization, keep-alive through ping, reconnect capabilities, and better cache handling.

<Note>
  When you provide data streams from a custom backend, you need to set the
  `x-vercel-ai-ui-message-stream` header to `v1`.
</Note>

The following stream parts are currently supported:

### Message Start Part

Indicates the beginning of a new message with metadata.

Format: Server-Sent Event with JSON object

Example:

```
data: {"type":"start","messageId":"..."}

```

### Text Parts

Text content is streamed using a start/delta/end pattern with unique IDs for each text block.

#### Text Start Part

Indicates the beginning of a text block.

Format: Server-Sent Event with JSON object

Example:

```
data: {"type":"text-start","id":"msg_68679a454370819ca74c8eb3d04379630dd1afb72306ca5d"}

```

#### Text Delta Part

Contains incremental text content for the text block.

Format: Server-Sent Event with JSON object

Example:

```
data: {"type":"text-delta","id":"msg_68679a454370819ca74c8eb3d04379630dd1afb72306ca5d","delta":"Hello"}

```

#### Text End Part

Indicates the completion of a text block.

Format: Server-Sent Event with JSON object

Example:

```
data: {"type":"text-end","id":"msg_68679a454370819ca74c8eb3d04379630dd1afb72306ca5d"}

```

### Reasoning Parts

Reasoning content is streamed using a start/delta/end pattern with unique IDs for each reasoning block.

#### Reasoning Start Part

Indicates the beginning of a reasoning block.

Format: Server-Sent Event with JSON object

Example:

```
data: {"type":"reasoning-start","id":"reasoning_123"}

```

#### Reasoning Delta Part

Contains incremental reasoning content for the reasoning block.

Format: Server-Sent Event with JSON object

Example:

```
data: {"type":"reasoning-delta","id":"reasoning_123","delta":"This is some reasoning"}

```

#### Reasoning End Part

Indicates the completion of a reasoning block.

Format: Server-Sent Event with JSON object

Example:

```
data: {"type":"reasoning-end","id":"reasoning_123"}

```

### Source Parts

Source parts provide references to external content sources.

#### Source URL Part

References to external URLs.

Format: Server-Sent Event with JSON object

Example:

```
data: {"type":"source-url","sourceId":"https://example.com","url":"https://example.com"}

```

#### Source Document Part

References to documents or files.

Format: Server-Sent Event with JSON object

Example:

```
data: {"type":"source-document","sourceId":"https://example.com","mediaType":"file","title":"Title"}

```

### File Part

The file parts contain references to files with their media type.

Format: Server-Sent Event with JSON object

Example:

```
data: {"type":"file","url":"https://example.com/file.png","mediaType":"image/png"}

```

### Data Parts

Custom data parts allow streaming of arbitrary structured data with type-specific handling.

Format: Server-Sent Event with JSON object where the type includes a custom suffix

Example:

```
data: {"type":"data-weather","data":{"location":"SF","temperature":100}}

```

The `data-*` type pattern allows you to define custom data types that your frontend can handle specifically.

### Error Part

The error parts are appended to the message as they are received.

Format: Server-Sent Event with JSON object

Example:

```
data: {"type":"error","errorText":"error message"}

```

### Tool Input Start Part

Indicates the beginning of tool input streaming.

Format: Server-Sent Event with JSON object

Example:

```
data: {"type":"tool-input-start","toolCallId":"call_fJdQDqnXeGxTmr4E3YPSR7Ar","toolName":"getWeatherInformation"}

```

### Tool Input Delta Part

Incremental chunks of tool input as it's being generated.

Format: Server-Sent Event with JSON object

Example:

```
data: {"type":"tool-input-delta","toolCallId":"call_fJdQDqnXeGxTmr4E3YPSR7Ar","inputTextDelta":"San Francisco"}

```

### Tool Input Available Part

Indicates that tool input is complete and ready for execution.

Format: Server-Sent Event with JSON object

Example:

```
data: {"type":"tool-input-available","toolCallId":"call_fJdQDqnXeGxTmr4E3YPSR7Ar","toolName":"getWeatherInformation","input":{"city":"San Francisco"}}

```

### Tool Output Available Part

Contains the result of tool execution.

Format: Server-Sent Event with JSON object

Example:

```
data: {"type":"tool-output-available","toolCallId":"call_fJdQDqnXeGxTmr4E3YPSR7Ar","output":{"city":"San Francisco","weather":"sunny"}}

```

### Start Step Part

A part indicating the start of a step.

Format: Server-Sent Event with JSON object

Example:

```
data: {"type":"start-step"}

```

### Finish Step Part

A part indicating that a step (i.e., one LLM API call in the backend) has been completed.

This part is necessary to correctly process multiple stitched assistant calls, e.g. when calling tools in the backend, and using steps in `useChat` at the same time.

Format: Server-Sent Event with JSON object

Example:

```
data: {"type":"finish-step"}

```

### Finish Message Part

A part indicating the completion of a message.

Format: Server-Sent Event with JSON object

Example:

```
data: {"type":"finish"}

```

### Stream Termination

The stream ends with a special `[DONE]` marker.

Format: Server-Sent Event with literal `[DONE]`

Example:

```
data: [DONE]

```
