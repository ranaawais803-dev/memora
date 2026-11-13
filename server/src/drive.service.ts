import { Injectable, Logger } from '@nestjs/common';
import { google, drive_v3 } from 'googleapis';
import * as fs from 'fs';
import { Chat, Item, Media, Store } from './store';

const ROOT = 'Weave';

/**
 * Google Drive "Smart Library":
 *   Weave/<Chat name>/<Year>/<AI category>/<file>
 *   Weave/<Chat name>/Weave Notes  (Google Doc with summaries, Keeps, Plans, Knowledge)
 * Uses the drive.file scope, so Weave can only see files it created itself.
 */
@Injectable()
export class DriveService {
  private log = new Logger('Drive');
  private folderCache = new Map<string, string>();

  constructor(private store: Store) {}

  get configured() {
    return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
  }

  get connected() {
    return !!this.store.db.google?.tokens;
  }

  private oauth() {
    const client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/drive/callback',
    );
    if (this.store.db.google?.tokens) client.setCredentials(this.store.db.google.tokens);
    client.on('tokens', (t) => {
      this.store.db.google = { ...this.store.db.google, tokens: { ...this.store.db.google?.tokens, ...t } };
      this.store.save();
    });
    return client;
  }

  authUrl() {
    return this.oauth().generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: ['https://www.googleapis.com/auth/drive.file', 'https://www.googleapis.com/auth/userinfo.email'],
    });
  }

  async finishAuth(code: string) {
    const client = this.oauth();
    const { tokens } = await client.getToken(code);
    client.setCredentials(tokens);
    const me = await google.oauth2({ version: 'v2', auth: client }).userinfo.get();
    this.store.db.google = { tokens, email: me.data.email ?? undefined };
    this.store.save();
  }

  disconnect() {
    delete this.store.db.google;
    this.folderCache.clear();
    this.store.save();
  }

  private api(): drive_v3.Drive {
    return google.drive({ version: 'v3', auth: this.oauth() });
  }

  private async folder(name: string, parent?: string): Promise<string> {
    const key = `${parent ?? 'root'}/${name}`;
    const hit = this.folderCache.get(key);
    if (hit) return hit;
    const drive = this.api();
    const safe = name.replace(/'/g, "\\'");
    const q = `mimeType='application/vnd.google-apps.folder' and name='${safe}' and trashed=false` + (parent ? ` and '${parent}' in parents` : '');
    const found = await drive.files.list({ q, fields: 'files(id)', spaces: 'drive' });
    let id = found.data.files?.[0]?.id;
    if (!id) {
      const made = await drive.files.create({
        requestBody: { name, mimeType: 'application/vnd.google-apps.folder', parents: parent ? [parent] : undefined },
        fields: 'id',
      });
      id = made.data.id!;
    }
    this.folderCache.set(key, id);
    return id;
  }

  private async chatFolder(chat: Chat) {
    return this.folder(chat.name, await this.folder(ROOT));
  }

  async uploadMedia(chat: Chat, media: Media, filePath: string, date: Date) {
    if (!this.connected) return;
    try {
      const yearId = await this.folder(String(date.getFullYear()), await this.chatFolder(chat));
      const catId = await this.folder(media.category || 'Other', yearId);
      const res = await this.api().files.create({
        requestBody: { name: media.name, parents: [catId], description: media.caption },
        media: { mimeType: media.mime, body: fs.createReadStream(filePath) },
        fields: 'id, webViewLink',
      });
      media.driveId = res.data.id ?? undefined;
      media.driveLink = res.data.webViewLink ?? undefined;
    } catch (e: any) {
      this.log.warn(`Upload failed: ${e?.message}`);
    }
  }

  /** Writes / refreshes the "Weave Notes" Google Doc for a chat. */
  async syncNotes(chat: Chat) {
    if (!this.connected) return;
    const i = chat.insights;
    const list = (title: string, items: Item[]) =>
      `${title}\n${
        items
          .map((x) => {
            const meta = [x.assignee && `@${x.assignee}`, x.due ? `due ${x.due}` : x.when].filter(Boolean).join(', ');
            const subs = (x.subtasks ?? []).map((s) => `\n    ${s.done ? '✓' : '◦'} ${s.text}`).join('');
            return `${x.done ? '✓' : '•'} ${x.text}${meta ? ` (${meta})` : ''}${x.notes ? `\n    ${x.notes}` : ''}${subs}`;
          })
          .join('\n') || '—'
      }\n`;
    const body = [
      `${chat.emoji} ${chat.name} — Weave Notes`,
      `Updated ${new Date().toLocaleString()}\n`,
      `Today: ${i.summaries.today || '—'}`,
      `This week: ${i.summaries.week || '—'}`,
      `This month: ${i.summaries.month || '—'}`,
      `This year: ${i.summaries.year || '—'}\n`,
      list('KEEPS', i.keeps),
      list('PLANS', i.plans),
      list('GOOD TO KNOW', i.knowledge),
      `TOPICS: ${i.topics.join(', ') || '—'}`,
    ].join('\n');
    try {
      const drive = this.api();
      const parent = await this.chatFolder(chat);
      const existing = await drive.files.list({ q: `name='Weave Notes' and '${parent}' in parents and trashed=false`, fields: 'files(id)' });
      const media = { mimeType: 'text/plain', body };
      const id = existing.data.files?.[0]?.id;
      if (id) await drive.files.update({ fileId: id, media });
      else await drive.files.create({ requestBody: { name: 'Weave Notes', parents: [parent], mimeType: 'application/vnd.google-apps.document' }, media });
    } catch (e: any) {
      this.log.warn(`Notes sync failed: ${e?.message}`);
    }
  }
}
