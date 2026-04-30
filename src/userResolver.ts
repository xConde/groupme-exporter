import { GroupMember, Message } from './model.js';

export class UserResolver {
  private map = new Map<string, string>();

  seedFromGroupMembers(members: GroupMember[]): void {
    for (const m of members) {
      if (m.user_id && m.nickname) {
        this.map.set(m.user_id, m.nickname);
      }
    }
  }

  seedFromDmParticipants(self: { user_id: string; name: string }, otherUserId: string, otherName: string): void {
    if (self.user_id && self.name) this.map.set(self.user_id, self.name);
    if (otherUserId && otherName) this.map.set(otherUserId, otherName);
  }

  observeMessages(messages: Message[]): void {
    for (const m of messages) {
      if (m.user_id && m.name && !this.map.has(m.user_id)) {
        this.map.set(m.user_id, m.name);
      }
    }
  }

  resolve(userId: string): string {
    return this.map.get(userId) ?? userId;
  }

  resolveMany(userIds: string[]): string[] {
    return userIds.map(id => this.resolve(id));
  }

  size(): number {
    return this.map.size;
  }
}
