# Frontend Implementation Guide

Complete guide for implementing the Heritage RAG System frontend using Next.js, TypeScript, Zustand, shadcn/ui, Axios, Zod, and React Hook Form.

## Table of Contents

1. [Project Setup](#project-setup)
2. [Project Structure](#project-structure)
3. [API Client Setup](#api-client-setup)
4. [State Management (Zustand)](#state-management-zustand)
5. [Type Definitions (Zod Schemas)](#type-definitions-zod-schemas)
6. [UI Components (shadcn/ui)](#ui-components-shadcnui)
7. [Feature Implementation](#feature-implementation)
8. [Pages and Routes](#pages-and-routes)
9. [Form Handling](#form-handling)
10. [Streaming Responses](#streaming-responses)

---

## Project Setup

### 1. Initialize Next.js Project

```bash
npx create-next-app@latest heritage-rag-frontend --typescript --tailwind --eslint --app
cd heritage-rag-frontend
```

### 2. Install Dependencies

```bash
# State Management
npm install zustand

# API Client
npm install axios

# Form Handling
npm install react-hook-form @hookform/resolvers zod

# UI Components (shadcn/ui)
npx shadcn-ui@latest init
npx shadcn-ui@latest add button input textarea card dialog scroll-area separator avatar badge spinner toast
```

### 3. Environment Configuration

Create `.env.local`:

```env
NEXT_PUBLIC_API_URL=http://localhost:8000/api/v1
```

---

## Project Structure

```
heritage-rag-frontend/
├── app/
│   ├── layout.tsx
│   ├── page.tsx
│   ├── conversations/
│   │   ├── page.tsx
│   │   └── [id]/
│   │       └── page.tsx
│   └── upload/
│       └── page.tsx
├── components/
│   ├── ui/              # shadcn/ui components
│   ├── chat/
│   │   ├── ChatMessage.tsx
│   │   ├── ChatInput.tsx
│   │   ├── ChatWindow.tsx
│   │   └── MessageList.tsx
│   ├── conversations/
│   │   ├── ConversationList.tsx
│   │   └── ConversationItem.tsx
│   └── upload/
│       └── DocumentUpload.tsx
├── lib/
│   ├── api/
│   │   ├── client.ts
│   │   ├── conversations.ts
│   │   ├── chat.ts
│   │   └── upload.ts
│   ├── schemas/
│   │   ├── requests.ts
│   │   └── responses.ts
│   └── utils/
│       └── formatDate.ts
├── store/
│   ├── chatStore.ts
│   ├── conversationStore.ts
│   └── uploadStore.ts
└── types/
    └── index.ts
```

---

## API Client Setup

### 1. Axios Client Configuration

**File: `lib/api/client.ts`**

Create a centralized Axios instance:
- Base URL from `NEXT_PUBLIC_API_URL`
- Request interceptors for adding auth headers (if needed)
- Response interceptors for error handling
- Type-safe request/response handling

### 2. API Service Functions

**File: `lib/api/chat.ts`**
- `askNewQuestion(query)` - POST `/chat/new` for starting new conversations
- `askQuestion(conversationId, query)` - POST `/chat/{conversation_id}` for continuing conversations
- Handle streaming responses using `fetch` with `ReadableStream`
- Extract `conversation_id` from `X-Conversation-Id` header
- Handle 404 errors for invalid conversation_ids
- Return non-streaming response as fallback

**File: `lib/api/conversations.ts`**
- `getConversations()` - GET `/conversations`
- `getConversationMessages(conversationId, limit?)` - GET `/conversations/{id}/messages`
- Handle pagination with `limit` parameter

**File: `lib/api/upload.ts`**
- `uploadDocument(file, metadata?)` - POST `/upload`
- Use `FormData` for multipart/form-data
- Handle file upload progress (optional)
- Parse response for file URL and status

---

## Type Definitions (Zod Schemas)

### 1. Request Schemas

**File: `lib/schemas/requests.ts`**

Define Zod schemas matching backend request models:
- `AskRequestSchema` - `{ query: string }` (min length 1)
  - Note: `conversation_id` is NOT in the request body - it's in the URL path
- `UploadRequestSchema` - Optional metadata object

### 2. Response Schemas

**File: `lib/schemas/responses.ts`**

Define Zod schemas for API responses:
- `MessageResponseSchema` - id, conversation_id, role, content, metadata, created_at
- `ConversationResponseSchema` - conversation_id, title, messages[], total
- `ConversationListItemSchema` - conversation_id, title, last_message_at
- `ConversationsListResponseSchema` - conversations[], total
- `UploadResponseSchema` - status, file_path, public_url, message
- `AskResponseSchema` - conversation_id, response, query (for non-streaming)
- `HealthResponseSchema` - status, timestamp

### 3. TypeScript Types

**File: `types/index.ts`**

Export TypeScript types inferred from Zod schemas:
```typescript
export type Message = z.infer<typeof MessageResponseSchema>
export type Conversation = z.infer<typeof ConversationResponseSchema>
export type ConversationListItem = z.infer<typeof ConversationListItemSchema>
// ... etc
```

---

## State Management (Zustand)

### 1. Chat Store

**File: `store/chatStore.ts`**

Manage chat state:
- `currentConversationId: string | null`
- `messages: Message[]`
- `isLoading: boolean`
- `isStreaming: boolean`
- `error: string | null`
- Actions:
  - `sendMessage(query: string)` - Send message and handle streaming
  - `addMessage(message: Message)` - Add message to current conversation
  - `setConversationId(id: string)` - Set active conversation
  - `clearChat()` - Reset chat state
  - `loadConversation(id: string)` - Load conversation messages

### 2. Conversation Store

**File: `store/conversationStore.ts`**

Manage conversations list:
- `conversations: ConversationListItem[]`
- `isLoading: boolean`
- `selectedConversationId: string | null`
- Actions:
  - `fetchConversations()` - Load all conversations
  - `selectConversation(id: string)` - Set selected conversation
  - `addConversation(item: ConversationListItem)` - Add new conversation
  - `updateConversationTitle(id: string, title: string)` - Update title

### 3. Upload Store

**File: `store/uploadStore.ts`**

Manage document upload state:
- `isUploading: boolean`
- `uploadProgress: number`
- `uploadedFiles: UploadResponse[]`
- `error: string | null`
- Actions:
  - `uploadFile(file: File, metadata?)` - Upload document
  - `resetUpload()` - Clear upload state

---

## UI Components (shadcn/ui)

### 1. Chat Components

**File: `components/chat/ChatMessage.tsx`**
- Display individual message with role (user/assistant)
- Format content (support markdown if needed)
- Show timestamp
- Different styling for user vs assistant messages
- Use shadcn `Card` component for message container
- Use `Avatar` for user/assistant icons

**File: `components/chat/ChatInput.tsx`**
- Text input/textarea for user queries
- Submit button (disabled during loading/streaming)
- Use `react-hook-form` with Zod validation
- Use shadcn `Input` or `Textarea` component
- Show loading/spinner state

**File: `components/chat/ChatWindow.tsx`**
- Container for chat interface
- `MessageList` component (scrollable)
- `ChatInput` component at bottom
- Handle streaming message updates
- Auto-scroll to bottom on new messages
- Use shadcn `ScrollArea` for message list

**File: `components/chat/MessageList.tsx`**
- Render list of `ChatMessage` components
- Handle empty state
- Loading state while fetching messages
- Use `ScrollArea` for smooth scrolling

### 2. Conversation List Components

**File: `components/conversations/ConversationList.tsx`**
- Sidebar/list of all conversations
- Load conversations on mount
- Select conversation to view
- Show conversation title and last message timestamp
- Empty state when no conversations
- Use shadcn `Card` or `Separator` for layout

**File: `components/conversations/ConversationItem.tsx`**
- Individual conversation item
- Display title (or "New Conversation" if no title)
- Display last message timestamp (formatted)
- Highlight selected conversation
- Click to navigate/select
- Use shadcn `Card` component

### 3. Upload Component

**File: `components/upload/DocumentUpload.tsx`**
- File input with drag-and-drop support
- Display selected file name
- Upload button
- Progress indicator during upload
- Success/error messages using shadcn `Toast`
- Use shadcn `Button`, `Card`, `Progress` components
- Optional: Preview uploaded files list

---

## Feature Implementation

### 1. Document Upload Feature

**Page: `app/upload/page.tsx`**

Implementation steps:
1. Use `uploadStore` for state management
2. Create form with file input using `react-hook-form`
3. Validate file type and size on client side
4. Call `uploadDocument()` API function
5. Show upload progress (if implemented)
6. Display success message with file URL
7. Handle errors with error messages
8. Redirect to conversations or show success toast

**Form Handling:**
- Use `useForm` from `react-hook-form`
- Use Zod schema for validation (file type, size limits)
- Use `@hookform/resolvers/zod` for resolver
- Handle file selection and form submission

### 2. Chat Feature

**Page: `app/conversations/[id]/page.tsx`**

Implementation steps:
1. Get `conversation_id` from URL params
2. Use `chatStore` to load conversation messages
3. Display messages in `ChatWindow` component
4. Handle sending new messages
5. Handle streaming responses:
   - Update message content as chunks arrive
   - Show streaming indicator
   - Save complete message when done
6. Handle conversation title updates
7. Update URL if new conversation created

**Streaming Implementation:**
- Use `fetch` API with `ReadableStream`
- Process chunks as they arrive
- Update UI reactively using Zustand store
- Handle `X-Conversation-Id` header from response
- Fallback to non-streaming if streaming fails

**Endpoint Selection:**
- New chat (no conversation_id): Use `POST /api/v1/chat/new`
- Continue chat (has conversation_id): Use `POST /api/v1/chat/{conversation_id}`
- Store conversation_id from response for subsequent requests
- Handle 404 errors by clearing invalid conversation_id and allowing new chat

### 3. Conversations List Feature

**Page: `app/conversations/page.tsx`**

Implementation steps:
1. Use `conversationStore` to fetch conversations
2. Display list using `ConversationList` component
3. Handle conversation selection
4. Navigate to conversation detail page
5. Show empty state if no conversations
6. Handle loading and error states
7. Sort conversations by `last_message_at` (newest first)

---

## Pages and Routes

### 1. Main Layout

**File: `app/layout.tsx`**
- Root layout with navigation
- Sidebar with conversation list (persistent)
- Main content area for chat/conversations
- Toast provider for notifications
- Theme provider (if using dark mode)

### 2. Home Page

**File: `app/page.tsx`**
- Redirect to `/conversations` or show welcome screen
- Option to start new conversation
- Option to upload documents

### 3. Conversations List Page

**File: `app/conversations/page.tsx`**
- Display all conversations
- "New Conversation" button
- Link to upload page
- Select conversation to view

### 4. Conversation Detail Page

**File: `app/conversations/[id]/page.tsx`**
- Dynamic route with conversation ID
- Load and display conversation messages
- Chat interface for new messages
- Handle both existing and new conversations
- Update page title with conversation title

### 5. Upload Page

**File: `app/upload/page.tsx`**
- Document upload form
- File selection interface
- Upload progress and status
- List of uploaded files (optional)

---

## Form Handling

### 1. Chat Input Form

**Component: `components/chat/ChatInput.tsx`**

Use `react-hook-form` with Zod:
- Schema: `AskRequestSchema` (query: string, min 1)
- Use `useForm` hook
- Use `Textarea` component from shadcn
- Handle submit to call `sendMessage()` from store
- Clear form after submission
- Disable during loading/streaming

### 2. Upload Form

**Component: `components/upload/DocumentUpload.tsx`**

Use `react-hook-form` with Zod:
- Schema for file validation (type, size)
- File input with drag-and-drop
- Handle file selection
- Submit to `uploadFile()` from store
- Show validation errors
- Reset form after successful upload

---

## Streaming Responses

### Implementation Strategy

**File: `lib/api/chat.ts` - Streaming Function**

1. Use `fetch` API instead of Axios for streaming
2. Set `stream: true` query parameter
3. Process `ReadableStream` response:
   - Read chunks using `response.body.getReader()`
   - Decode text chunks
   - Update Zustand store with each chunk
   - Accumulate full message
4. Extract `conversation_id` from `X-Conversation-Id` header
5. Handle errors and connection issues
6. Provide fallback to non-streaming if needed

**Store Integration:**
- `chatStore.sendMessage()` calls streaming API
- Updates `currentMessage` state as chunks arrive
- Adds complete message to `messages` array when done
- Sets `isStreaming` state during streaming
- Handles `conversation_id` updates

**UI Updates:**
- Show streaming indicator (typing animation)
- Update message content in real-time
- Scroll to bottom as content streams
- Mark message as complete when streaming ends

---

## Additional Features

### 1. Error Handling

- Global error handler in API client
- Display error toasts using shadcn `Toast`
- Handle network errors gracefully
- Show retry options for failed requests
- Store error state in Zustand stores

### 2. Loading States

- Show loading spinners during API calls
- Disable buttons during loading
- Show skeleton loaders for list items
- Use shadcn `Spinner` or `Skeleton` components

### 3. Date Formatting

**File: `lib/utils/formatDate.ts`**

Utility function to format timestamps:
- Use `date-fns` or native `Intl.DateTimeFormat`
- Format `last_message_at` and `created_at`
- Show relative time (e.g., "2 hours ago")
- Show absolute time on hover

### 4. Message Formatting

- Support markdown rendering (optional, use `react-markdown`)
- Preserve line breaks
- Format code blocks if needed
- Handle special characters

### 5. Responsive Design

- Mobile-friendly layout
- Collapsible sidebar on mobile
- Responsive chat window
- Touch-friendly input areas

### 6. Real-time Updates (Optional)

- Poll for new messages in active conversation
- Update conversation list periodically
- Show notification for new conversations

---

## API Integration Details

### Chat API Structure

The chat API uses two separate endpoints based on conversation state:

**New Conversation Flow:**
- Endpoint: `POST /api/v1/chat/new`
- Request body: `{ "query": "user message" }`
- `conversation_id` is NOT included in the request body
- Response includes `conversation_id` in `X-Conversation-Id` header
- Store the returned `conversation_id` for subsequent messages

**Continue Conversation Flow:**
- Endpoint: `POST /api/v1/chat/{conversation_id}`
- `conversation_id` is in the URL path (not in request body)
- Request body: `{ "query": "user message" }`
- Response includes `conversation_id` in `X-Conversation-Id` header
- If conversation doesn't exist, returns 404 error

**Error Handling:**
- 404 Error: Conversation not found
  - Clear stored `conversation_id`
  - Show error message: "Conversation not found. Starting new chat..."
  - Allow user to start a new conversation

### Endpoints to Implement

1. **POST `/api/v1/chat/new`** - Start new conversation
   - Request: `{ query: string }` (conversation_id NOT in body)
   - Query params: `stream=true` (optional)
   - Response: Streaming text/plain or JSON
   - Header: `X-Conversation-Id` (returns new conversation_id)

2. **POST `/api/v1/chat/{conversation_id}`** - Continue existing conversation
   - Path param: `conversation_id` (required)
   - Request: `{ query: string }` (conversation_id NOT in body)
   - Query params: `stream=true` (optional)
   - Response: Streaming text/plain or JSON
   - Header: `X-Conversation-Id` (returns conversation_id)
   - Error: 404 if conversation not found

3. **GET `/api/v1/conversations`**
   - Query params: `limit=50` (optional)
   - Response: `{ conversations: [], total: number }`

3. **GET `/api/v1/conversations/{id}/messages`**
   - Path param: `conversation_id`
   - Query params: `limit` (optional)
   - Response: `{ conversation_id, title, messages: [], total: number }`

4. **POST `/api/v1/upload`**
   - Request: `FormData` with `file` and optional `metadata` query param
   - Response: `{ status, file_path, public_url, message }`

5. **GET `/api/v1/health`**
   - Response: `{ status: "healthy", timestamp: string }`

---

## Best Practices

1. **Type Safety**
   - Use Zod schemas for runtime validation
   - Infer TypeScript types from schemas
   - Type all API responses and requests

2. **Error Handling**
   - Centralized error handling in API client
   - User-friendly error messages
   - Logging for debugging

3. **Performance**
   - Optimize re-renders with React.memo where needed
   - Use Zustand selectors to prevent unnecessary re-renders
   - Implement pagination for long conversation lists

4. **Accessibility**
   - Proper ARIA labels
   - Keyboard navigation
   - Screen reader support

5. **Code Organization**
   - Separate concerns (API, state, UI)
   - Reusable components
   - Utility functions for common operations

---

## Testing Considerations

1. **Unit Tests**
   - Test Zustand stores
   - Test API client functions
   - Test utility functions

2. **Integration Tests**
   - Test form submissions
   - Test API integrations
   - Test state updates

3. **E2E Tests** (Optional)
   - Test complete user flows
   - Test chat interactions
   - Test file uploads

---

This guide provides the complete architecture and implementation strategy. Follow each section to build a production-ready frontend that integrates seamlessly with the Heritage RAG System API.

