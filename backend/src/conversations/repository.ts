import { v7 as uuidv7 } from 'uuid'
import { AppError } from '../lib/errors.js'

export type ConversationStatus = 'active' | 'archived'
export type ConversationRole = 'system' | 'user' | 'assistant' | 'tool'

export interface Conversation {
  id: string
  tripId: string
  title: string
  status: ConversationStatus
  createdAt: string
  updatedAt: string
}

export interface ConversationMessage {
  id: string
  conversationId: string
  role: ConversationRole
  content: string
  metadata: Record<string, unknown>
  createdAt: string
}

export interface ConversationRepository {
  create(input: { tripId: string; title?: string }): Promise<Conversation>
  get(conversationId: string): Promise<Conversation | undefined>
  appendMessage(input: {
    conversationId: string
    role: ConversationRole
    content: string
    metadata?: Record<string, unknown>
  }): Promise<ConversationMessage>
  listMessages(conversationId: string, limit?: number): Promise<ConversationMessage[]>
}

interface OwnedConversation extends Conversation { ownerId: string }
interface OwnedMessage extends ConversationMessage { ownerId: string }

export class InMemoryConversationRepository implements ConversationRepository {
  private readonly conversations: Map<string, OwnedConversation>
  private readonly messages: Map<string, OwnedMessage[]>

  constructor(
    private readonly ownerId: string,
    private readonly ownedTripIds: Set<string>,
    shared?: { conversations: Map<string, OwnedConversation>; messages: Map<string, OwnedMessage[]> }
  ) {
    this.conversations = shared?.conversations ?? new Map()
    this.messages = shared?.messages ?? new Map()
  }

  async create(input: { tripId: string; title?: string }): Promise<Conversation> {
    if (!this.ownedTripIds.has(input.tripId)) throw new AppError('RESOURCE_NOT_FOUND', 'Trip was not found', 404)
    const now = new Date().toISOString()
    const record: OwnedConversation = {
      id: uuidv7(), ownerId: this.ownerId, tripId: input.tripId,
      title: input.title ?? '', status: 'active', createdAt: now, updatedAt: now
    }
    this.conversations.set(record.id, record)
    const { ownerId: _ownerId, ...conversation } = record
    return structuredClone(conversation)
  }

  async get(conversationId: string): Promise<Conversation | undefined> {
    const record = this.conversations.get(conversationId)
    if (!record || record.ownerId !== this.ownerId) return undefined
    const { ownerId: _ownerId, ...conversation } = record
    return structuredClone(conversation)
  }

  async appendMessage(input: {
    conversationId: string; role: ConversationRole; content: string; metadata?: Record<string, unknown>
  }): Promise<ConversationMessage> {
    const conversation = this.conversations.get(input.conversationId)
    if (!conversation || conversation.ownerId !== this.ownerId) {
      throw new AppError('RESOURCE_NOT_FOUND', 'Conversation was not found', 404)
    }
    const message: OwnedMessage = {
      id: uuidv7(), ownerId: this.ownerId, conversationId: input.conversationId,
      role: input.role, content: input.content, metadata: structuredClone(input.metadata ?? {}),
      createdAt: new Date().toISOString()
    }
    const list = this.messages.get(input.conversationId) ?? []
    list.push(message)
    this.messages.set(input.conversationId, list)
    conversation.updatedAt = message.createdAt
    const { ownerId: _ownerId, ...publicMessage } = message
    return structuredClone(publicMessage)
  }

  async listMessages(conversationId: string, limit = 100): Promise<ConversationMessage[]> {
    const conversation = this.conversations.get(conversationId)
    if (!conversation || conversation.ownerId !== this.ownerId) {
      throw new AppError('RESOURCE_NOT_FOUND', 'Conversation was not found', 404)
    }
    return (this.messages.get(conversationId) ?? []).slice(-Math.max(1, Math.min(500, limit))).map(message => {
      const { ownerId: _ownerId, ...publicMessage } = message
      return structuredClone(publicMessage)
    })
  }
}
