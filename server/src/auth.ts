import { BadRequestException, CanActivate, ExecutionContext, Injectable, Logger, UnauthorizedException, createParamDecorator } from '@nestjs/common';
import { randomBytes, randomInt, randomUUID } from 'crypto';
import { Store, User , DEFAULT_SETTINGS, DEMO_PEOPLE } from './store';

export type PublicUser = Pick<User, 'id' | 'phone' | 'name' | 'avatar'>;
export const publicUser = (u: User): PublicUser => ({ id: u.id, phone: u.phone, name: u.name, avatar: u.avatar });
/** What the signed-in user sees about themselves (includes their settings). */
export const selfUser = (u: User) => ({ ...publicUser(u), settings: { ...DEFAULT_SETTINGS, ...u.settings } });

const SESSION_DAYS = 30;
const CODE_MINUTES = 10;
const MAX_ATTEMPTS = 5;

/** Keeps "+" and digits only: "+92 300-1234567" -> "+923001234567". */
export const normalizePhone = (raw: string) => {
  const s = (raw ?? '').trim();
  const digits = s.replace(/\D/g, '');
  return (s.startsWith('+') ? '+' : '') + digits;
};
const validPhone = (p: string) => /^\+?\d{7,15}$/.test(p);

/**
 * Phone-number login with one-time codes.
 * Codes are sent by SMS when Twilio is configured (TWILIO_* in .env); otherwise they're
 * printed in the server console and returned to the client so you can test locally.
 */
@Injectable()
export class AuthService {
  private log = new Logger('Auth');
  private codes = new Map<string, { code: string; expires: number; attempts: number }>();

  constructor(private store: Store) {}

  get smsConfigured() {
    return !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM);
  }

  async requestCode(raw: string) {
    const phone = normalizePhone(raw);
    if (!validPhone(phone)) throw new BadRequestException('Enter a valid phone number.');
    const prev = this.codes.get(phone);
    if (prev && prev.expires - CODE_MINUTES * 60000 + 30000 > Date.now()) throw new BadRequestException('Please wait 30 seconds before asking for a new code.');
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    this.codes.set(phone, { code, expires: Date.now() + CODE_MINUTES * 60000, attempts: 0 });
    const isNew = !this.store.db.users.some((u) => u.phone === phone);
    if (this.smsConfigured) {
      await this.sendSms(phone, `Your Weave code is ${code}`);
      return { sent: true, isNew };
    }
    this.log.log(`Login code for ${phone}: ${code}  (set TWILIO_* in .env to send real SMS)`);
    return { sent: false, isNew, devCode: code };
  }

  verify(raw: string, code: string, name?: string) {
    const phone = normalizePhone(raw);
    const entry = this.codes.get(phone);
    if (!entry || entry.expires < Date.now()) throw new UnauthorizedException('Code expired. Ask for a new one.');
    if (++entry.attempts > MAX_ATTEMPTS) {
      this.codes.delete(phone);
      throw new UnauthorizedException('Too many tries. Ask for a new code.');
    }
    if (entry.code !== String(code ?? '').trim()) throw new UnauthorizedException('Wrong code.');

    let user = this.store.db.users.find((u) => u.phone === phone);
    if (!user) {
      if (!name?.trim()) throw new BadRequestException('Tell us your name.');
      user = { id: randomUUID(), phone, name: name.trim().slice(0, 40), createdAt: new Date().toISOString() };
      // the first real person (not one of the demo accounts) becomes "You" in the demo chats
      const demo = new Set(DEMO_PEOPLE.map((p) => p.phone));
      const first = !this.store.db.users.some((u) => !demo.has(u.phone));
      this.store.db.users.push(user);
      if (first) this.adoptDemoChats(user);
    }
    this.codes.delete(phone);
    return this.startSession(user);
  }

  save() {
    this.store.save();
  }

  updateName(user: User, name: string) {
    if (!name?.trim()) throw new BadRequestException('Name is required.');
    const old = user.name;
    user.name = name.trim().slice(0, 40);
    for (const c of this.store.chatsFor(user.id)) c.members = c.members.map((m) => (m === old ? user.name : m));
    this.store.save();
    return publicUser(user);
  }

  logout(token: string) {
    this.store.db.sessions = this.store.db.sessions.filter((s) => s.token !== token);
    this.store.save();
  }

  /** Returns the user for a session token, or null if missing/expired. */
  userFor(token?: string | null): User | null {
    if (!token) return null;
    const s = this.store.db.sessions.find((x) => x.token === token);
    if (!s) return null;
    if (Date.now() - +new Date(s.createdAt) > SESSION_DAYS * 86400000) {
      this.logout(token);
      return null;
    }
    return this.store.user(s.userId) ?? null;
  }

  private startSession(user: User) {
    const token = randomBytes(32).toString('base64url');
    this.store.db.sessions.push({ token, userId: user.id, createdAt: new Date().toISOString() });
    this.store.save();
    return { token, user: selfUser(user) };
  }

  private async sendSms(to: string, body: string) {
    const sid = process.env.TWILIO_ACCOUNT_SID!;
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: 'Basic ' + Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ To: to, From: process.env.TWILIO_FROM!, Body: body }),
    });
    if (!res.ok) {
      this.log.warn(`SMS failed: ${res.status} ${await res.text()}`);
      throw new BadRequestException("Couldn't send the SMS. Check the number and try again.");
    }
  }

  /** The very first account inherits the demo chats (and becomes "You" in them). */
  private adoptDemoChats(user: User) {
    for (const chat of this.store.db.chats.filter((c) => c.members.includes('You') && !c.memberIds.includes(user.id))) {
      chat.memberIds.push(user.id);
      // you started the group chats and the client projects; the 1-to-1 belongs to both
      if (!chat.direct) chat.createdBy = user.id;
      chat.members = chat.members.map((m) => (m === 'You' ? user.name : m));
      if (!chat.members.includes(user.name)) chat.members.push(user.name);
      for (const m of this.store.messages(chat.id)) if (m.sender === 'You') Object.assign(m, { sender: user.name, senderId: user.id });
    }
  }
}

export const tokenFrom = (header?: string) => (header?.startsWith('Bearer ') ? header.slice(7) : null);

/** Blocks any request without a valid session; puts the user on req.user. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private auth: AuthService) {}
  canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest();
    const user = this.auth.userFor(tokenFrom(req.headers.authorization));
    if (!user) throw new UnauthorizedException('Please log in.');
    req.user = user;
    return true;
  }
}

export const CurrentUser = createParamDecorator((_d, ctx: ExecutionContext): User => ctx.switchToHttp().getRequest().user);
