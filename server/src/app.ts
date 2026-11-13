import { Body, Controller, Delete, ForbiddenException, Get, Headers, Injectable, Module, NotFoundException, Param, Patch, Post, Query, Res, UploadedFile, UseGuards, UseInterceptors, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ServeStaticModule } from '@nestjs/serve-static';
import { ConnectedSocket, MessageBody, OnGatewayConnection, OnGatewayDisconnect, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { diskStorage } from 'multer';
import { Server, Socket } from 'socket.io';
import { randomUUID } from 'crypto';
import * as path from 'path';
import type { Response } from 'express';
import { AiService } from './ai.service';
import { AuthGuard, AuthService, CurrentUser, normalizePhone, publicUser, tokenFrom , selfUser } from './auth';
import { DriveService } from './drive.service';
import { Chat, ChatInfo, Item, Media, MediaKind, Store, UPLOAD_DIR, User, emptyInsights , DEFAULT_SETTINGS, type UserSettings , STATUS_HOURS, type Status , type Vote } from './store';

/**
 * Real-time layer. Every socket must present a session token; it joins a private
 * room per user, and events for a chat are delivered only to that chat's members.
 */
@WebSocketGateway({ cors: { origin: '*' } })
export class Events implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() io: Server;
  private online = new Map<string, number>(); // userId -> open sockets

  constructor(private auth: AuthService, private store: Store) {}

  handleConnection(socket: Socket) {
    const user = this.auth.userFor(socket.handshake.auth?.token);
    if (!user) {
      socket.emit('unauthorized');
      return socket.disconnect(true);
    }
    socket.data.user = user;
    socket.join(`user:${user.id}`);
    const n = (this.online.get(user.id) ?? 0) + 1;
    this.online.set(user.id, n);
    if (n === 1) this.presence(user.id, true);
  }

  handleDisconnect(socket: Socket) {
    const user: User | undefined = socket.data.user;
    if (!user) return;
    const n = (this.online.get(user.id) ?? 1) - 1;
    if (n > 0) return void this.online.set(user.id, n);
    this.online.delete(user.id);
    this.presence(user.id, false);
  }

  isOnline = (userId: string) => this.online.has(userId);

  /** Send an event to everyone in a chat. */
  toChat(chat: Chat, event: string, payload?: unknown) {
    if (chat.memberIds.length) this.io.to(chat.memberIds.map((id) => `user:${id}`)).emit(event, payload);
  }

  toUsers(userIds: string[], event: string, payload?: unknown) {
    if (userIds.length) this.io.to(userIds.map((id) => `user:${id}`)).emit(event, payload);
  }

  /** Tell everyone who shares a chat with this user that they came online / went offline. */
  private presence(userId: string, online: boolean) {
    const contacts = new Set(this.store.chatsFor(userId).flatMap((c) => c.memberIds));
    contacts.delete(userId);
    this.toUsers([...contacts], 'presence', { userId, online });
  }

  @SubscribeMessage('typing')
  typing(@ConnectedSocket() socket: Socket, @MessageBody() b: { chatId: string; typing: boolean }) {
    const user: User = socket.data.user;
    const chat = this.store.chat(b?.chatId);
    if (!user || !chat?.memberIds.includes(user.id)) return;
    const others = chat.memberIds.filter((id) => id !== user.id);
    this.toUsers(others, 'typing', { chatId: chat.id, userId: user.id, name: user.name, typing: !!b.typing });
  }
}

/** Runs the invisible AI in the background, debounced per chat. */
@Injectable()
export class Organizer {
  private timers = new Map<string, NodeJS.Timeout>();
  constructor(private store: Store, private ai: AiService, private drive: DriveService, private events: Events) {}

  schedule(chat: Chat, delay = 8000) {
    clearTimeout(this.timers.get(chat.id));
    this.timers.set(chat.id, setTimeout(() => this.run(chat), delay));
  }

  async run(chat: Chat) {
    const insights = await this.ai.analyze(chat, this.store.messages(chat.id));
    this.store.save();
    this.events.toChat(chat, 'insights', { chatId: chat.id, insights });
    this.drive.syncNotes(chat);
    return insights;
  }
}

type List = 'keeps' | 'plans';

/** Accept only the editable task fields from the client. */
function clean(b: Partial<Item>): Partial<Item> {
  const out: Partial<Item> = {};
  if (typeof b.text === 'string' && b.text.trim()) out.text = b.text.trim();
  if (typeof b.done === 'boolean') out.done = b.done;
  if (typeof b.skipped === 'boolean') out.skipped = b.skipped;
  if (typeof b.notes === 'string') out.notes = b.notes;
  if (typeof b.assignee === 'string') out.assignee = b.assignee || undefined;
  if (typeof b.due === 'string') out.due = /^\d{4}-\d{2}-\d{2}$/.test(b.due) ? b.due : undefined;
  if (b.priority === 'low' || b.priority === 'normal' || b.priority === 'high') out.priority = b.priority;
  if (Array.isArray(b.subtasks))
    out.subtasks = b.subtasks.filter((s) => s && typeof s.text === 'string').map((s) => ({ id: s.id || randomUUID(), text: s.text, done: !!s.done }));
  if (Array.isArray(b.sourceIds)) out.sourceIds = b.sourceIds.filter((s) => typeof s === 'string').slice(0, 20);
  return out;
}

const kindOf = (mime: string): MediaKind => (mime.startsWith('image/') ? 'image' : mime.startsWith('video/') ? 'video' : mime.startsWith('audio/') ? 'audio' : 'file');

// ---------- Auth ----------
@Controller('api/auth')
export class AuthController {
  constructor(private auth: AuthService, private events: Events, private store: Store) {}

  /** Profile photo: upload a new one, or send no file to remove it. */
  @Post('me/avatar')
  @UseGuards(AuthGuard)
  @UseInterceptors(FileInterceptor('file', { storage: diskStorage({ destination: UPLOAD_DIR, filename: (_r, f, cb) => cb(null, `${randomUUID()}${path.extname(f.originalname) || '.jpg'}`) }), limits: { fileSize: 8 * 1024 * 1024 } }))
  avatar(@CurrentUser() u: User, @UploadedFile() file?: Express.Multer.File) {
    if (file && !file.mimetype.startsWith('image/')) throw new BadRequestException('Pick an image');
    u.avatar = file ? `/uploads/${file.filename}` : undefined;
    this.auth.save();
    // everyone who shares a chat sees the new photo
    this.events.toUsers([...new Set(this.store.chatsFor(u.id).flatMap((c) => c.memberIds))], 'chats');
    return selfUser(u);
  }

  @Post('code')
  requestCode(@Body() b: { phone: string }) {
    return this.auth.requestCode(b.phone);
  }

  @Post('verify')
  verify(@Body() b: { phone: string; code: string; name?: string }) {
    return this.auth.verify(b.phone, b.code, b.name);
  }

  @Patch('me')
  @UseGuards(AuthGuard)
  rename(@CurrentUser() u: User, @Body() b: { name?: string; settings?: Partial<UserSettings> }) {
    if (b.name !== undefined) this.auth.updateName(u, b.name);
    if (b.settings) {
      const next = { ...DEFAULT_SETTINGS, ...u.settings };
      for (const k of ['doneEmoji', 'yesEmoji', 'noEmoji', 'maybeEmoji'] as const) if (typeof b.settings[k] === 'string') next[k] = b.settings[k]!.slice(0, 16);
      u.settings = next;
    }
    this.auth.save();
    return selfUser(u);
  }

  @Post('logout')
  logout(@Headers('authorization') h?: string) {
    const t = tokenFrom(h);
    if (t) this.auth.logout(t);
    return { ok: true };
  }

  @Get('me')
  @UseGuards(AuthGuard)
  me(@CurrentUser() u: User) {
    return selfUser(u);
  }
}

@Controller('api')
@UseGuards(AuthGuard)
export class ApiController {
  constructor(private store: Store, private ai: AiService, private drive: DriveService, private org: Organizer, private events: Events) {}

  /** Finds a chat the current user is a member of. */
  private getChat(id: string, user: User) {
    const c = this.store.chat(id);
    if (!c) throw new NotFoundException('Chat not found');
    if (!c.memberIds.includes(user.id)) throw new ForbiddenException("You're not in this chat");
    return c;
  }

  private view(c: Chat, user: User) {
    const msgs = this.store.messages(c.id);
    const read = c.reads?.[user.id] ?? '';
    const other = c.direct ? this.store.user(c.memberIds.find((id) => id !== user.id) ?? '') : undefined;
    // any 2-person chat, renamed or not, shows the other person's profile photo by default
    const pair = c.memberIds.length === 2 ? this.store.user(c.memberIds.find((id) => id !== user.id) ?? '') : undefined;
    // 1) no name: the other people's names  2) the creator's name for it  3) your own name for it, only you see that
    const names = c.memberIds.filter((id) => id !== user.id).map((id) => this.store.user(id)?.name.split(' ')[0]).filter(Boolean);
    // one rule for every chat: the creator's custom name, otherwise everyone else's names
    void other;
    const auto = names.length ? names.slice(0, 3).join(', ') + (names.length > 3 ? ', …' : '') : 'Just you';
    const original = c.autoName || c.direct ? auto : c.name;
    const nickname = c.nicknames?.[user.id];
    return {
      ...c,
      nicknames: undefined,
      name: nickname || original,
      // your own photo for it > the creator's chat photo > (1-to-1) the other person's profile photo
      photo: c.photoFor?.[user.id] || c.photo || pair?.avatar || undefined,
      pair: c.memberIds.length === 2,
      // up to two other members, for the group picture when there is no custom photo
      faces: c.memberIds.filter((id) => id !== user.id).map((id) => this.store.user(id)).filter(Boolean).sort((a, b) => Number(!!b!.avatar) - Number(!!a!.avatar)).slice(0, 2).map((u) => ({ name: u!.name, avatar: u!.avatar })),
      hasChatPhoto: !!c.photo, // a custom photo the creator set (not someone's profile photo)
      photoFor: undefined,
      hasOwnPhoto: !!c.photoFor?.[user.id],
      originalName: original,
      nickname: nickname || undefined,
      isCreator: !c.createdBy || c.createdBy === user.id,
      people: c.memberIds.map((id) => this.store.user(id)).filter(Boolean).map((u) => ({ ...publicUser(u!), online: this.events.isOnline(u!.id) })),
      last: msgs.at(-1) ?? null,
      urgent: msgs.filter((m) => m.urgent).length,
      unread: msgs.filter((m) => m.senderId !== user.id && m.createdAt > read).length,
    };
  }

  @Get('status')
  status() {
    return { ai: this.ai.enabled, drive: { configured: this.drive.configured, connected: this.drive.connected, email: this.store.db.google?.email } };
  }

  @Get('users')
  findUsers(@CurrentUser() me: User, @Query('q') q = '') {
    q = q.trim().toLowerCase();
    const digits = q.replace(/\D/g, '');
    if (q.length < 2) return [];
    // Only people you already share a chat with can be found by name; anyone can be found by (most of) their number.
    const contacts = new Set(this.store.chatsFor(me.id).flatMap((c) => c.memberIds));
    return this.store.db.users
      .filter((u) => u.id !== me.id && ((digits.length >= 6 && u.phone.replace(/\D/g, '').includes(digits)) || (contacts.has(u.id) && u.name.toLowerCase().includes(q))))
      .slice(0, 10)
      .map(publicUser);
  }

  @Get('chats')
  chats(@CurrentUser() me: User) {
    return this.store
      .chatsFor(me.id)
      .map((c) => this.view(c, me))
      .sort((a, b) => +new Date(b.last?.createdAt ?? b.createdAt) - +new Date(a.last?.createdAt ?? a.createdAt));
  }

  @Post('chats')
  createChat(@CurrentUser() me: User, @Body() b: { name: string; emoji?: string; userIds?: string[] }) {
    const others = (b.userIds ?? []).map((id) => this.store.user(id)).filter((u): u is User => !!u && u.id !== me.id);
    const people = [me, ...new Map(others.map((u) => [u.id, u])).values()];
    const given = (b.name ?? '').trim().slice(0, 60);
    if (!given && people.length < 2) throw new BadRequestException('Add a name or at least one person.');
    const direct = !given && people.length === 2;
    const chat: Chat = {
      id: randomUUID(),
      // unnamed: 1-to-1 shows the other person's name (see view), groups use first names
      name: given || people.map((u) => u.name.split(' ')[0]).join(', '),
      direct,
      autoName: !given,
      emoji: b.emoji || '💬',
      members: people.map((u) => u.name),
      memberIds: people.map((u) => u.id),
      createdBy: me.id,
      createdAt: new Date().toISOString(),
      insights: emptyInsights(),
    };
    this.store.db.chats.push(chat);
    this.store.save();
    this.events.toChat(chat, 'chats');
    return this.view(chat, me);
  }

  /** Rename / change emoji / edit the optional Info (project details, custom fields). */
  @Patch('chats/:id')
  updateChat(@CurrentUser() me: User, @Param('id') id: string, @Body() b: { name?: string; emoji?: string; info?: ChatInfo }) {
    const chat = this.getChat(id, me);
    if (typeof b.name === 'string') {
      const name = b.name.trim().slice(0, 60);
      if (!chat.createdBy || chat.createdBy === me.id) {
        // the creator renames it for everyone; clearing it goes back to showing people's names
        if (name) { chat.name = name; chat.autoName = false; chat.direct = false; }
        else chat.autoName = true;
      } else {
        // anyone else: a private name, only they see it
        chat.nicknames ??= {};
        if (name) chat.nicknames[me.id] = name;
        else delete chat.nicknames[me.id];
        this.store.save();
        this.events.toUsers([me.id], 'chats');
        return this.view(chat, me);
      }
    }
    if (typeof b.emoji === 'string' && b.emoji) chat.emoji = b.emoji.slice(0, 8);
    // details (about, deadline, info fields) belong to the creator; everyone else just sees them
    if (b.info && typeof b.info === 'object' && chat.createdBy && chat.createdBy !== me.id) throw new ForbiddenException('Only the person who made this chat can change its details.');
    if (b.info && typeof b.info === 'object') {
      const i = b.info;
      chat.info = {
        project: !!i.project,
        about: typeof i.about === 'string' ? i.about.slice(0, 2000) : chat.info?.about,
        dueDate: typeof i.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(i.dueDate) ? i.dueDate : undefined,
        fields: Array.isArray(i.fields)
          ? i.fields.filter((f) => f && typeof f.label === 'string').slice(0, 30).map((f) => ({ id: f.id || randomUUID(), label: f.label.slice(0, 60), value: String(f.value ?? '').slice(0, 500) }))
          : chat.info?.fields,
      };
    }
    this.store.save();
    this.events.toChat(chat, 'chats');
    return this.view(chat, me);
  }

  /** Light stats for the Info tab: activity per day, who's chatting, shared media, keeps/plans progress. */
  @Get('chats/:id/stats')
  stats(@CurrentUser() me: User, @Param('id') id: string) {
    const chat = this.getChat(id, me);
    const msgs = this.store.messages(chat.id);
    const DAYS = 14;
    const day = (d: Date) => d.toISOString().slice(0, 10);
    const perDay = Array.from({ length: DAYS }, (_, i) => ({ date: day(new Date(Date.now() - (DAYS - 1 - i) * 86400000)), count: 0 }));
    const idx = new Map(perDay.map((d, i) => [d.date, i]));
    const people = new Map<string, number>();
    const media = { photos: 0, videos: 0, voice: 0, files: 0 };
    for (const m of msgs) {
      const i = idx.get(m.createdAt.slice(0, 10));
      if (i !== undefined) perDay[i].count++;
      people.set(m.sender, (people.get(m.sender) ?? 0) + 1);
      if (m.media) media[({ image: 'photos', video: 'videos', audio: 'voice', file: 'files' } as const)[m.media.kind]]++;
    }
    const tally = (l: Item[]) => ({ open: l.filter((x) => !x.done).length, done: l.filter((x) => x.done).length });
    return {
      total: msgs.length,
      since: msgs[0]?.createdAt ?? chat.createdAt,
      perDay,
      people: [...people].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 8),
      media,
      keeps: tally(chat.insights.keeps),
      plans: tally(chat.insights.plans),
    };
  }

  @Post('chats/:id/members')
  addMember(@CurrentUser() me: User, @Param('id') id: string, @Body() b: { userId?: string; phone?: string }) {
    const chat = this.getChat(id, me);
    const phone = normalizePhone(b.phone ?? '');
    const user = b.userId ? this.store.user(b.userId) : this.store.db.users.find((u) => u.phone === phone);
    if (!user) throw new BadRequestException('No one with that number has joined Weave yet.');
    if (!chat.memberIds.includes(user.id)) {
      chat.memberIds.push(user.id);
      if (!chat.members.includes(user.name)) chat.members.push(user.name);
      if (chat.direct) {
        // a third person turns a 1-to-1 into a group named after everyone
        chat.direct = false;
        chat.name = chat.memberIds.map((id) => this.store.user(id)?.name.split(' ')[0]).filter(Boolean).join(', ');
      }
      this.store.save();
    }
    this.events.toChat(chat, 'chats');
    return this.view(chat, me);
  }

  @Post('chats/:id/leave')
  leave(@CurrentUser() me: User, @Param('id') id: string) {
    const chat = this.getChat(id, me);
    chat.memberIds = chat.memberIds.filter((x) => x !== me.id);
    this.store.save();
    this.events.toChat(chat, 'chats');
    this.events.toUsers([me.id], 'chats');
    return { ok: true };
  }

  @Post('chats/:id/read')
  markRead(@CurrentUser() me: User, @Param('id') id: string) {
    const chat = this.getChat(id, me);
    (chat.reads ??= {})[me.id] = new Date().toISOString();
    this.store.save();
    this.events.toUsers([me.id], 'chats');
    return { ok: true };
  }

  @Get('chats/:id/messages')
  messages(@CurrentUser() me: User, @Param('id') id: string) {
    return this.store.messages(this.getChat(id, me).id);
  }

  @Post('chats/:id/messages')
  @UseInterceptors(FileInterceptor('file', { storage: diskStorage({ destination: UPLOAD_DIR, filename: (_r, f, cb) => cb(null, `${randomUUID()}${path.extname(f.originalname) || '.webm'}`) }), limits: { fileSize: 50 * 1024 * 1024 } }))
  async send(@CurrentUser() me: User, @Param('id') id: string, @Body() b: { text?: string; transcript?: string; clientId?: string; replyToId?: string }, @UploadedFile() file?: Express.Multer.File) {
    const chat = this.getChat(id, me);
    if (!chat.members.includes(me.name)) chat.members.push(me.name);
    let media: Media | undefined;
    if (file) media = { url: `/uploads/${file.filename}`, name: file.originalname, mime: file.mimetype, kind: kindOf(file.mimetype), size: file.size };
    const text = (b.text ?? '').trim().slice(0, 10000);
    if (!text && !media) throw new BadRequestException('Empty message');
    const replyToId = b.replyToId && this.store.messages(chat.id).some((m) => m.id === b.replyToId) ? b.replyToId : undefined;
    const msg = this.store.addMessage({ chatId: chat.id, senderId: me.id, sender: me.name, text, media, transcript: b.transcript?.trim() || undefined, replyToId });
    (chat.reads ??= {})[me.id] = msg.createdAt;
    this.events.toChat(chat, 'message', { ...msg, clientId: b.clientId });

    // background: sort media into the Smart Library + check voice urgency
    (async () => {
      if (msg.transcript) msg.urgent = await this.ai.urgency(msg.transcript);
      if (media && file) {
        Object.assign(media, await this.ai.classifyMedia(chat, media, file.path, this.store.messages(chat.id)));
        await this.drive.uploadMedia(chat, media, file.path, new Date(msg.createdAt));
      }
      this.store.save();
      this.events.toChat(chat, 'message:update', msg);
    })();

    this.org.schedule(chat);
    return msg;
  }

  @Get('chats/:id/insights')
  async insights(@CurrentUser() me: User, @Param('id') id: string) {
    const chat = this.getChat(id, me);
    const count = this.store.messages(id).length;
    if (!chat.insights.updatedAt || chat.insights.analyzedCount !== count) return this.org.run(chat);
    return chat.insights;
  }

  @Post('chats/:id/insights/refresh')
  refresh(@CurrentUser() me: User, @Param('id') id: string) {
    return this.org.run(this.getChat(id, me));
  }

  // ---------- Tasks (Keeps / Plans): editable, assignable, deadlines, subtasks ----------
  private findItem(chat: Chat, itemId: string) {
    for (const list of ['keeps', 'plans', 'knowledge'] as const) {
      const idx = chat.insights[list].findIndex((x) => x.id === itemId);
      if (idx >= 0) return { list, idx, item: chat.insights[list][idx] };
    }
    throw new NotFoundException('Task not found');
  }

  private changed(chat: Chat) {
    this.store.save();
    this.events.toChat(chat, 'insights', { chatId: chat.id, insights: chat.insights });
    this.drive.syncNotes(chat);
  }

  @Post('chats/:id/items')
  addItem(@CurrentUser() me: User, @Param('id') id: string, @Body() b: Partial<Item> & { list?: List }) {
    const chat = this.getChat(id, me);
    const item: Item = { ...clean(b), id: randomUUID(), text: b.text?.trim() || 'New task', source: 'manual', createdAt: new Date().toISOString() };
    chat.insights[b.list === 'plans' ? 'plans' : (b.list as string) === 'knowledge' ? 'knowledge' : 'keeps'].unshift(item);
    this.changed(chat);
    return item;
  }

  @Patch('chats/:id/items/:itemId')
  updateItem(@CurrentUser() me: User, @Param('id') id: string, @Param('itemId') itemId: string, @Body() b: Partial<Item> & { list?: List }) {
    const chat = this.getChat(id, me);
    const { list, idx, item } = this.findItem(chat, itemId);
    const patch = clean(b);
    const wasDone = !!item.done;
    // anything beyond a checkmark counts as a user edit, so the AI leaves it alone
    const wasSkipped = !!item.skipped;
    if (Object.keys(patch).some((k) => k !== 'done' && k !== 'skipped')) item.edited = true;
    // "done" is per person: your tick adds or removes you; it counts as done while anyone has ticked it
    if (typeof patch.done === 'boolean') {
      this.markDone(item, me.id, patch.done);
      delete patch.done;
    }
    Object.assign(item, patch);
    void wasDone; void wasSkipped;
    if ((b.list === 'keeps' || b.list === 'plans') && b.list !== list && list !== 'knowledge') {
      chat.insights[list].splice(idx, 1);
      chat.insights[b.list].unshift(item);
    }
    this.changed(chat);
    return item;
  }

  /** Answer a plan: yes / no / maybe. Sending your current answer again takes it back. */
  @Post('chats/:id/items/:itemId/vote')
  vote(@CurrentUser() me: User, @Param('id') id: string, @Param('itemId') itemId: string, @Body() b: { vote: Vote | null }) {
    const chat = this.getChat(id, me);
    const { item, list } = this.findItem(chat, itemId);
    this.setVote(item, me.id, b.vote === 'yes' || b.vote === 'no' || b.vote === 'maybe' ? b.vote : null);
    const now = item.votes?.[me.id];
    void now; void list;
    this.changed(chat);
    return item;
  }

  private markDone(item: Item, userId: string, done: boolean) {
    const by = new Set(item.doneBy ?? []);
    if (done) by.add(userId);
    else by.delete(userId);
    item.doneBy = [...by];
    item.done = by.size > 0 || undefined;
  }

  private setVote(item: Item, userId: string, vote: Vote | null) {
    item.votes ??= {};
    if (!vote || item.votes[userId] === vote) delete item.votes[userId];
    else item.votes[userId] = vote;
  }

  @Delete('chats/:id/items/:itemId')
  deleteItem(@CurrentUser() me: User, @Param('id') id: string, @Param('itemId') itemId: string) {
    const chat = this.getChat(id, me);
    const { list, idx, item } = this.findItem(chat, itemId);
    chat.insights[list].splice(idx, 1);
    if (item.source !== 'manual') (chat.insights.dismissed ??= []).push(item.origin ?? item.text.toLowerCase());
    this.changed(chat);
    return { ok: true };
  }

  /** Chat photo: the creator sets it for everyone, anyone else sets one only they see. No file = remove. */
  @Post('chats/:id/photo')
  @UseInterceptors(FileInterceptor('file', { storage: diskStorage({ destination: UPLOAD_DIR, filename: (_r, f, cb) => cb(null, `${randomUUID()}${path.extname(f.originalname) || '.jpg'}`) }), limits: { fileSize: 8 * 1024 * 1024 } }))
  chatPhoto(@CurrentUser() me: User, @Param('id') id: string, @UploadedFile() file?: Express.Multer.File) {
    const chat = this.getChat(id, me);
    if (file && !file.mimetype.startsWith('image/')) throw new BadRequestException('Pick an image');
    const url = file ? `/uploads/${file.filename}` : undefined;
    if (!chat.createdBy || chat.createdBy === me.id) {
      chat.photo = url;
      this.store.save();
      this.events.toChat(chat, 'chats');
    } else {
      chat.photoFor ??= {};
      if (url) chat.photoFor[me.id] = url;
      else delete chat.photoFor[me.id];
      this.store.save();
      this.events.toUsers([me.id], 'chats');
    }
    return this.view(chat, me);
  }

  // ---------- Status: photo or text, visible to everyone you share a chat with, for 24 hours ----------
  private contactsOf(userId: string) {
    return new Set([userId, ...this.store.chatsFor(userId).flatMap((c) => c.memberIds)]);
  }

  private liveStatuses() {
    const cutoff = Date.now() - STATUS_HOURS * 3600000;
    this.store.db.statuses = this.store.db.statuses.filter((s) => +new Date(s.createdAt) > cutoff);
    return this.store.db.statuses;
  }

  @Get('statuses')
  statuses(@CurrentUser() me: User) {
    const people = this.contactsOf(me.id);
    return this.liveStatuses()
      .filter((s) => people.has(s.userId))
      // only the owner sees who viewed it
      .map((s) => ({ ...s, name: this.store.user(s.userId)?.name ?? s.name, viewers: s.userId === me.id ? s.viewers : s.viewers.includes(me.id) ? [me.id] : [] }));
  }

  @Post('statuses')
  @UseInterceptors(FileInterceptor('file', { storage: diskStorage({ destination: UPLOAD_DIR, filename: (_r, f, cb) => cb(null, `${randomUUID()}${path.extname(f.originalname) || '.jpg'}`) }), limits: { fileSize: 20 * 1024 * 1024 } }))
  postStatus(@CurrentUser() me: User, @Body() b: { text?: string; bg?: string }, @UploadedFile() file?: Express.Multer.File) {
    const text = (b.text ?? '').trim().slice(0, 700);
    if (file && !/^(image|video)\//.test(file.mimetype)) throw new BadRequestException('Status can be a photo, a video or text');
    if (!text && !file) throw new BadRequestException('Write something or pick a photo');
    const s: Status = {
      id: randomUUID(),
      userId: me.id,
      name: me.name,
      text: text || undefined,
      bg: !file ? (b.bg || '#2f5bf5').slice(0, 20) : undefined,
      media: file ? { url: `/uploads/${file.filename}`, mime: file.mimetype } : undefined,
      viewers: [],
      createdAt: new Date().toISOString(),
    };
    this.store.db.statuses.push(s);
    this.store.save();
    this.events.toUsers([...this.contactsOf(me.id)], 'statuses');
    return s;
  }

  @Post('statuses/:sid/seen')
  seenStatus(@CurrentUser() me: User, @Param('sid') sid: string) {
    const s = this.liveStatuses().find((x) => x.id === sid);
    if (!s || !this.contactsOf(me.id).has(s.userId)) throw new NotFoundException('Status not found');
    if (s.userId !== me.id && !s.viewers.includes(me.id)) {
      s.viewers.push(me.id);
      this.store.save();
      this.events.toUsers([s.userId], 'statuses');
    }
    return { ok: true };
  }

  @Delete('statuses/:sid')
  deleteStatus(@CurrentUser() me: User, @Param('sid') sid: string) {
    const i = this.store.db.statuses.findIndex((x) => x.id === sid && x.userId === me.id);
    if (i < 0) throw new NotFoundException('Status not found');
    this.store.db.statuses.splice(i, 1);
    this.store.save();
    this.events.toUsers([...this.contactsOf(me.id)], 'statuses');
    return { ok: true };
  }

  // ---------- Topics people add or remove themselves ----------
  @Post('chats/:id/topics')
  addTopic(@CurrentUser() me: User, @Param('id') id: string, @Body() b: { name: string; about?: string }) {
    const chat = this.getChat(id, me);
    const name = (b.name ?? '').trim().slice(0, 40);
    if (!name) throw new BadRequestException('Topic needs a name');
    const ins = chat.insights;
    ins.manualTopics = [...new Set([...(ins.manualTopics ?? []), name])];
    ins.dismissedTopics = (ins.dismissedTopics ?? []).filter((t) => t.toLowerCase() !== name.toLowerCase());
    if (!ins.topics.some((t) => t.toLowerCase() === name.toLowerCase())) ins.topics.unshift(name);
    if (b.about?.trim()) ins.topicNotes = { ...ins.topicNotes, [name]: b.about.trim().slice(0, 300) };
    this.changed(chat);
    return ins;
  }

  @Delete('chats/:id/topics/:name')
  removeTopic(@CurrentUser() me: User, @Param('id') id: string, @Param('name') name: string) {
    const chat = this.getChat(id, me);
    const ins = chat.insights;
    const k = name.toLowerCase();
    ins.topics = ins.topics.filter((t) => t.toLowerCase() !== k);
    ins.manualTopics = (ins.manualTopics ?? []).filter((t) => t.toLowerCase() !== k);
    ins.dismissedTopics = [...new Set([...(ins.dismissedTopics ?? []), k])];
    this.changed(chat);
    return ins;
  }

  // ---------- Emoji reactions (and the "done" emoji that ticks things off) ----------
  @Post('chats/:id/messages/:mid/react')
  react(@CurrentUser() me: User, @Param('id') id: string, @Param('mid') mid: string, @Body() b: { emoji: string }) {
    const chat = this.getChat(id, me);
    const msg = this.store.messages(chat.id).find((m) => m.id === mid);
    if (!msg) throw new NotFoundException('Message not found');
    const emoji = (b.emoji ?? '').slice(0, 16);
    if (!emoji) throw new BadRequestException('Pick an emoji');
    const list = (msg.reactions ??= []);
    const at = list.findIndex((r) => r.userId === me.id && r.emoji === emoji);
    const added = at < 0;
    if (added) list.push({ emoji, userId: me.id, name: me.name });
    else list.splice(at, 1);
    if (!list.length) delete msg.reactions;
    this.store.save();
    this.events.toChat(chat, 'message:update', msg);

    // reacting with your "done" emoji ticks off whatever keeps/plans came from that message
    const s = { ...DEFAULT_SETTINGS, ...me.settings };
    let hit = false;
    if (s.doneEmoji && emoji === s.doneEmoji)
      for (const l of ['keeps', 'plans'] as const)
        for (const it of chat.insights[l]) if (it.sourceIds?.includes(mid)) { this.markDone(it, me.id, added); hit = true; }
    // your yes / no / maybe emoji on a plan's message answers that plan
    const vote: Vote | null = emoji === s.yesEmoji ? 'yes' : emoji === s.noEmoji ? 'no' : emoji === s.maybeEmoji ? 'maybe' : null;
    if (vote)
      for (const it of chat.insights.plans)
        if (it.sourceIds?.includes(mid)) {
          it.votes ??= {};
          if (added) it.votes[me.id] = vote;
          else if (it.votes[me.id] === vote) delete it.votes[me.id];
          hit = true;
        }
    if (hit) this.changed(chat);
    this.org.schedule(chat); // reactions count as answers ("👍" = agreed)
    return msg;
  }

  @Get('chats/:id/recap')
  recap(@CurrentUser() me: User, @Param('id') id: string) {
    const chat = this.getChat(id, me);
    return this.ai.recap(chat, this.store.messages(id));
  }

  @Get('chats/:id/library')
  library(@CurrentUser() me: User, @Param('id') id: string) {
    const msgs = this.store.messages(this.getChat(id, me).id).filter((m) => m.media);
    // { "2026": { "Trip to Murree": [media...] } }
    const out: Record<string, Record<string, (Media & { messageId: string; sender: string; createdAt: string })[]>> = {};
    for (const m of msgs) {
      const y = m.createdAt.slice(0, 4);
      const cat = m.media!.category || 'Sorting…';
      ((out[y] ??= {})[cat] ??= []).push({ ...m.media!, messageId: m.id, sender: m.sender, createdAt: m.createdAt });
    }
    return out;
  }

  /** Universal search across the user's own chats: messages, voice, media, tasks, knowledge. */
  @Get('search')
  search(@CurrentUser() me: User, @Query('q') q = '') {
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    const hit = (s?: string) => !!s && terms.every((t) => s.toLowerCase().includes(t));
    const mine = this.store.chatsFor(me.id);
    const ids = new Set(mine.map((c) => c.id));
    const results: any[] = [];
    for (const m of this.store.db.messages) {
      if (!ids.has(m.chatId)) continue;
      const chat = this.store.chat(m.chatId)!;
      const base = { chatId: chat.id, chatName: chat.name, emoji: chat.emoji, messageId: m.id, sender: m.sender, createdAt: m.createdAt };
      if (hit(m.text)) results.push({ ...base, type: 'message', text: m.text });
      if (hit(m.transcript)) results.push({ ...base, type: 'voice', text: m.transcript, media: m.media });
      if (m.media && (hit(m.media.caption) || hit(m.media.name) || hit(m.media.category)))
        results.push({ ...base, type: m.media.kind, text: m.media.caption || m.media.name, media: m.media });
    }
    for (const chat of mine) {
      const base = { chatId: chat.id, chatName: chat.name, emoji: chat.emoji };
      for (const [type, list] of [['keep', chat.insights.keeps], ['plan', chat.insights.plans], ['knowledge', chat.insights.knowledge]] as const)
        for (const it of list) if (hit(it.text) || hit(it.notes) || hit(it.assignee) || it.subtasks?.some((st) => hit(st.text))) results.push({ ...base, type, text: it.text, createdAt: chat.insights.updatedAt });
    }
    return results.sort((a, b) => +new Date(b.createdAt ?? 0) - +new Date(a.createdAt ?? 0)).slice(0, 60);
  }

  @Post('drive/disconnect')
  disconnect() {
    this.drive.disconnect();
    return { ok: true };
  }
}

// ---------- Google Drive OAuth (browser redirects, so these can't carry a Bearer header) ----------
@Controller('api/drive')
export class DriveController {
  constructor(private drive: DriveService) {}

  @Get('connect')
  connect(@Res() res: Response) {
    if (!this.drive.configured) return res.status(400).send('Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in server/.env first.');
    res.redirect(this.drive.authUrl());
  }

  @Get('callback')
  async callback(@Query('code') code: string, @Res() res: Response) {
    await this.drive.finishAuth(code);
    res.redirect((process.env.WEB_URL || 'http://localhost:5173') + '/?drive=connected');
  }
}

@Module({
  imports: [ServeStaticModule.forRoot({ rootPath: UPLOAD_DIR, serveRoot: '/uploads' })],
  controllers: [AuthController, ApiController, DriveController],
  providers: [Store, AuthService, AuthGuard, AiService, DriveService, Organizer, Events],
})
export class AppModule {}
