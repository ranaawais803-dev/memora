import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';

export type MediaKind = 'image' | 'video' | 'audio' | 'file';

export interface Media {
  url: string;
  name: string;
  mime: string;
  kind: MediaKind;
  size: number;
  category?: string; // AI-chosen folder, e.g. "Trip to Murree"
  caption?: string; // AI description, used by search
  driveId?: string;
  driveLink?: string;
}

export interface User {
  id: string;
  phone: string; // unique, normalized ("+923001234567")
  name: string; // display name
  createdAt: string;
  settings?: UserSettings;
  avatar?: string; // profile photo url
}

/** doneEmoji: reacting with it to a message ticks off the keeps/plans that came from it ("" = off). */
/** Reaction emojis with a meaning: done ticks things off; yes/no/maybe answer a plan. "" = off. */
export interface UserSettings { doneEmoji: string; yesEmoji: string; noEmoji: string; maybeEmoji: string }
export const DEFAULT_SETTINGS: UserSettings = { doneEmoji: '✅', yesEmoji: '', noEmoji: '', maybeEmoji: '' };
export type Vote = 'yes' | 'no' | 'maybe';
export interface Reaction { emoji: string; userId: string; name: string }

export interface Session {
  token: string;
  userId: string;
  createdAt: string;
}

export interface Message {
  id: string;
  chatId: string;
  replyToId?: string; // the message this one answers
  reactions?: Reaction[];
  event?: { itemId: string; list: 'keeps' | 'plans'; kind: 'done' | 'undone' | 'skipped' | 'unskipped' | 'yes' | 'no' | 'maybe' }; // small linked note: someone ticked or answered an item
  senderId?: string;
  sender: string;
  text: string;
  createdAt: string;
  media?: Media;
  transcript?: string; // voice notes
  urgent?: { summary: string } | null;
}

export interface Subtask {
  id: string;
  text: string;
  done?: boolean;
}

export type Priority = 'low' | 'normal' | 'high';

export interface Item {
  doneBy?: string[]; // userIds who marked it done (several people can)
  skipped?: boolean; // not needed any more (cancelled), kept for the record
  votes?: Record<string, Vote>; // plans: userId -> yes / no / maybe
  id: string;
  text: string;
  done?: boolean;
  when?: string; // free-text time the AI heard ("Friday 8pm")
  notes?: string; // longer description
  assignee?: string; // chat member responsible
  due?: string; // deadline, YYYY-MM-DD
  priority?: Priority;
  subtasks?: Subtask[];
  source?: 'ai' | 'manual';
  edited?: boolean; // user changed it, so the AI won't overwrite or drop it
  origin?: string; // lowercased text the AI first extracted (avoids duplicates after edits)
  sourceIds?: string[]; // messages this came from, for jumping between chat and organized
  createdAt?: string;
}

export interface Insights {
  keeps: Item[]; // things not to forget
  plans: Item[]; // things agreed on
  topics: string[]; // conversation themes
  topicNotes?: Record<string, string>; // topic -> short description from the chat
  knowledge: Item[]; // useful facts (addresses, numbers, recipes...)
  summaries: Partial<Record<Period, string>>;
  dismissed?: string[]; // AI items the user deleted, so they don't come back
  manualTopics?: string[]; // topics people added themselves
  dismissedTopics?: string[]; // topics people removed
  firstAt?: string; // oldest message, used to auto-pick the summary window
  updatedAt?: string;
  analyzedCount?: number;
}

export type Period = 'today' | 'week' | 'month' | 'year';

/** Optional extra details: mostly unused, handy for project or catalogue chats. */
export interface ChatInfo {
  project?: boolean;
  about?: string;
  dueDate?: string; // YYYY-MM-DD
  fields?: { id: string; label: string; value: string }[]; // e.g. Client, Budget, Catalogue link
}

export interface Chat {
  id: string;
  name: string;
  emoji: string;
  members: string[]; // display names (used by the AI and task assignees)
  memberIds: string[]; // user ids allowed in this chat
  direct?: boolean; // unnamed 1-to-1 chat: each person sees the other's name
  info?: ChatInfo;
  reads?: Record<string, string>; // userId -> last read ISO time
  createdBy?: string;
  autoName?: boolean; // no name given: show the other members' names
  nicknames?: Record<string, string>;
  photo?: string; // chat photo the creator set (everyone sees it)
  photoFor?: Record<string, string>; // userId -> private chat photo, only they see it // userId -> the name that person gave the chat, only for them
  createdAt: string;
  insights: Insights;
  driveFolderId?: string;
}

/** A WhatsApp-style status: a photo or a line of text on a colour, gone after 24 hours. */
export interface Status {
  id: string;
  userId: string;
  name: string;
  text?: string;
  bg?: string; // background for text-only statuses
  media?: { url: string; mime: string };
  viewers: string[]; // user ids who have seen it
  createdAt: string;
}
export const STATUS_HOURS = 24;

interface Db {
  users: User[];
  statuses: Status[];
  sessions: Session[];
  chats: Chat[];
  messages: Message[];
  google?: { tokens: any; email?: string; rootId?: string };
}

export const DATA_DIR = path.join(process.cwd(), 'data');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'db.json');

export const emptyInsights = (): Insights => ({ keeps: [], plans: [], topics: [], knowledge: [], summaries: {} });

/** Tiny JSON-file database: plenty for a prototype, swap for Postgres later. */
@Injectable()
export class Store {
  db: Db;
  private timer?: NodeJS.Timeout;

  constructor() {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    this.db = fs.existsSync(DB_FILE) ? JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) : seed();
    // migrate older databases
    this.db.users = (this.db.users ?? []).filter((u) => u.phone);
    this.db.sessions ??= [];
    this.db.statuses = (this.db.statuses ?? []).filter((s) => Date.now() - +new Date(s.createdAt) < STATUS_HOURS * 3600000);
    for (const c of this.db.chats) {
      c.memberIds ??= [];
      // older unnamed 1-to-1 chats were saved as "New chat"
      if (c.name === 'New chat' && c.memberIds.length === 2 && c.direct === undefined) c.direct = true;
    }
    this.save();
  }

  user(id: string) {
    return this.db.users.find((u) => u.id === id);
  }

  chatsFor(userId: string) {
    return this.db.chats.filter((c) => c.memberIds.includes(userId));
  }

  save() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => fs.writeFileSync(DB_FILE, JSON.stringify(this.db, null, 2)), 100);
  }

  chat(id: string) {
    return this.db.chats.find((c) => c.id === id);
  }

  messages(chatId: string) {
    return this.db.messages.filter((m) => m.chatId === chatId);
  }

  addMessage(m: Omit<Message, 'id' | 'createdAt'> & { createdAt?: string }): Message {
    const msg: Message = { id: randomUUID(), createdAt: new Date().toISOString(), ...m };
    this.db.messages.push(msg);
    this.save();
    return msg;
  }
}

/**
 * Demo data: real-looking chats for family, friends, a small studio and its clients.
 * "You" is whoever logs in first: they take over every "You" in here.
 * The other people are real accounts (log in with their number to chat as them).
 */
export const DEMO_PEOPLE: { name: string; phone: string }[] = [
  { name: 'Ammi', phone: '+923000000001' },
  { name: 'Ali', phone: '+923000000002' },
  { name: 'Sara', phone: '+923000000003' },
  { name: 'Hamza', phone: '+923000000004' },
  { name: 'Zoya', phone: '+923000000005' },
  { name: 'Ayesha', phone: '+923000000006' },
  { name: 'Usman', phone: '+923000000007' },
  { name: 'Mr. Khan', phone: '+923000000008' },
  { name: 'Nadia', phone: '+923000000009' },
];

function seed(): Db {
  const day = 86400000;
  const now = Date.now();
  const iso = (daysAgo: number) => new Date(now - daysAgo * day).toISOString();
  const date = (daysFromNow: number) => new Date(now + daysFromNow * day).toISOString().slice(0, 10);

  const users: User[] = DEMO_PEOPLE.map((p, i) => ({ id: randomUUID(), phone: p.phone, name: p.name, createdAt: iso(300 - i) }));
  const id = (name: string) => users.find((u) => u.name === name)!.id;

  const chat = (name: string, emoji: string, people: string[], ageDays: number, extra: Partial<Chat> = {}): Chat => ({
    id: randomUUID(),
    name,
    emoji,
    members: [...people, 'You'],
    memberIds: people.map(id), // "You" joins when the first person logs in
    createdAt: iso(ageDays),
    insights: emptyInsights(),
    ...extra,
  });

  const family = chat('Family', '🏡', ['Ammi', 'Ali', 'Sara'], 400)
  const ali = chat('Ali', '💬', ['Ali'], 200, { direct: true })
  const crew = chat('Weekend Crew', '⚽', ['Hamza', 'Zoya'], 90)
  const studio = chat('Studio Team', '🚀', ['Ayesha', 'Usman'], 150, {
    info: { project: true, about: 'Our small design & web studio: day-to-day work, invoices and hiring.', fields: [{ id: randomUUID(), label: 'Office', value: 'Office 12, Gulberg III, Lahore' }] },
  })
  const bright = chat('Bright Foods · Website', '🍊', ['Mr. Khan', 'Ayesha', 'Usman'], 40, {
    info: {
      project: true,
      about: 'New website and online menu for Bright Foods (12 branches).',
      dueDate: date(18),
      fields: [
        { id: randomUUID(), label: 'Client', value: 'Bright Foods Pvt Ltd' },
        { id: randomUUID(), label: 'Budget', value: 'PKR 850,000' },
        { id: randomUUID(), label: 'Website', value: 'brightfoods.pk' },
      ],
    },
  })
  const glow = chat('Glow Salon · Catalogue', '💅', ['Nadia', 'Ayesha'], 25, {
    info: {
      project: true,
      about: 'Printed price catalogue + Instagram posts for Glow Salon’s winter menu.',
      dueDate: date(9),
      fields: [
        { id: randomUUID(), label: 'Client', value: 'Glow Salon, DHA Phase 5' },
        { id: randomUUID(), label: 'Catalogue', value: '24 pages, A5, 500 copies' },
        { id: randomUUID(), label: 'Budget', value: 'PKR 120,000' },
      ],
    },
  })

  // [chat, sender, text, days ago]
  const lines: [Chat, string, string, number][] = [
    // ---- Family ----
    [family, 'Ammi', 'Assalam o alaikum everyone. Can someone buy milk, eggs and bread tomorrow?', 12],
    [family, 'You', "I'll get them on my way back from work", 12],
    [family, 'Ali', 'Should we do the Murree trip this winter?', 10],
    [family, 'Sara', "Yes! Let's go on the 20th, I can take 3 days off", 10],
    [family, 'Ammi', 'Ok 20th it is. Ali please book the hotel, and someone check the car', 9.8],
    [family, 'Ali', 'Booked Pearl Continental Bhurban, 2 rooms for 3 nights. Confirmation no. PC-88213', 9],
    [family, 'You', "I'll get the car serviced before the trip", 8.9],
    [family, 'Sara', 'I will pack snacks and the warm blankets 🧣', 8.8],
    [family, 'Ammi', 'Electricity bill is due on the 25th, ref no. 0412 7781 2290. Who is paying this month?', 6],
    [family, 'Ali', "I'll pay it online tonight", 5.9],
    [family, 'Sara', "Reminder: my passport expires in March, I need to renew it before the Dubai wedding", 4],
    [family, 'Ammi', "Nani's dinner on Friday at 8pm, everyone please come on time", 2],
    [family, 'You', "We'll be there 👍", 1.9],
    [family, 'Ammi', "Also Dr. Aslam's clinic changed number: 042-3577-1100. Appointment for Abbu is Tuesday 11am", 0.6],
    [family, 'Ali', 'Paid the electricity bill ✅', 0.3],

    // ---- Ali (1-to-1) ----
    [ali, 'Ali', 'Bhai can you pick me up from the airport on Sunday? Flight lands 6:40pm, PK-304', 3],
    [ali, 'You', 'Sure, terminal 1?', 3],
    [ali, 'Ali', 'Yes T1. Also remind me to return Hamza’s drill, it’s been a month 😅', 2.9],
    [ali, 'You', 'Haha ok. Also the car service is booked for Saturday 10am at Honda Gulberg', 1],

    // ---- Weekend Crew ----
    [crew, 'Hamza', 'Football Saturday 5pm at the usual ground?', 4],
    [crew, 'Zoya', "I'm in. I'll bring the ball and cones", 4],
    [crew, 'You', 'Count me in 👍', 3.9],
    [crew, 'Hamza', 'Movie night after? New Dune is out', 3],
    [crew, 'Zoya', "Yes, let's book tickets for the 9:30pm show at Cinestar", 2.9],
    [crew, 'You', "I'll book 3 tickets", 2.8],
    [crew, 'Hamza', "Also Zoya's birthday is on the 2nd 🎂 let's plan something (Zoya don't read this 😂)", 1.5],
    [crew, 'Zoya', 'I literally can see this 🙃', 1.4],
    [crew, 'Hamza', 'Fine. Surprise dinner then, everyone send me ideas by Thursday', 1.3],

    // ---- Studio Team ----
    [studio, 'Ayesha', 'Good morning team ☀️ This week: Bright Foods homepage, Glow catalogue drafts', 7],
    [studio, 'Usman', 'Server for Bright Foods is ready on staging: staging.brightfoods.pk', 6.5],
    [studio, 'You', 'Great. Usman please set up the SSL and backups too', 6.4],
    [studio, 'Ayesha', 'We need to hire a junior designer. I’ll post the job on Rozee by Friday', 5],
    [studio, 'You', 'Budget for the junior role is 70-90k. Interviews next week', 4.9],
    [studio, 'Usman', 'Office rent (PKR 95,000) is due on the 5th, and the internet bill too', 3],
    [studio, 'You', "I'll transfer the rent tomorrow", 2.9],
    [studio, 'Ayesha', 'Figma team plan renews on the 15th, card on file is expiring, please update', 1],
    [studio, 'Usman', 'Wifi password changed: Studio@2026! (for the new router)', 0.4],

    // ---- Bright Foods · Website (client project) ----
    [bright, 'Mr. Khan', 'Hello team, we want the new site live before our winter menu launch', 40],
    [bright, 'You', 'Welcome Mr. Khan! We’ll share the plan and timeline by Monday', 40],
    [bright, 'You', 'Plan: 1) Homepage design 2) Menu pages for 12 branches 3) Online ordering link 4) Launch', 38],
    [bright, 'Mr. Khan', 'Agreed. Launch date is the 1st of next month, please don’t miss it', 37],
    [bright, 'Ayesha', 'Homepage design will be ready for review by Thursday', 20],
    [bright, 'Mr. Khan', 'Can you also add a careers page? We are hiring riders', 15],
    [bright, 'You', 'Yes, adding it. Ayesha can you design the careers page too?', 15],
    [bright, 'Ayesha', 'Sure, I’ll do it after the homepage', 14.9],
    [bright, 'Mr. Khan', 'Sending the logo files and brand colours: orange #FF7A00, green #1F8A4C', 12],
    [bright, 'Usman', 'Menu pages are 60% done. I need the final prices list from the client', 6],
    [bright, 'Mr. Khan', 'Prices list will be sent by Wednesday. Also the first invoice: please send it to accounts@brightfoods.pk', 5],
    [bright, 'You', 'I’ll send invoice #INV-1042 (50% advance, PKR 425,000) today', 4.9],
    [bright, 'Ayesha', 'Homepage v2 is uploaded to Figma, Mr. Khan please review and approve', 2],
    [bright, 'Mr. Khan', 'Looks great! Only make the "Order now" button bigger. Approved otherwise 👍', 1],
    [bright, 'Usman', 'Online ordering will use their Foodpanda link for now, can switch later', 0.5],

    // ---- Glow Salon · Catalogue (client project) ----
    [glow, 'Nadia', 'Hi! We need a printed price catalogue for our winter services, 24 pages, A5', 25],
    [glow, 'You', 'Hi Nadia, happy to help. Delivery in about 3 weeks, 500 copies?', 25],
    [glow, 'Nadia', 'Yes 500 copies. Please also make 6 Instagram posts from it', 24],
    [glow, 'Ayesha', 'I’ll need your logo, service list with prices and 10-15 photos of the salon', 23],
    [glow, 'Nadia', 'Photoshoot at the salon is on Saturday 2pm, Ayesha can you come?', 10],
    [glow, 'Ayesha', 'Yes, I’ll be there with the camera 📸', 10],
    [glow, 'Nadia', 'Prices: Haircut 2,500 · Facial 4,000 · Bridal package 85,000. Full list in the PDF I’ll send', 6],
    [glow, 'You', 'Thanks! First draft by Monday. Printing at Rehman Printers, proof before final print', 5],
    [glow, 'Ayesha', 'Draft 1 is ready, pages 1-12 done. Remaining by Thursday', 1.2],
    [glow, 'Nadia', 'Love it 😍 please change the cover photo to the pink one', 0.8],
  ];

  const chats = [family, ali, crew, studio, bright, glow];
  for (const c of chats) c.createdBy = c.memberIds[0]; // replaced by "You" on first login for chats you start

  return {
    users,
    statuses: [
      { id: randomUUID(), userId: id('Zoya'), name: 'Zoya', text: 'Saturday football ⚽ who’s in?', bg: '#059669', viewers: [], createdAt: new Date(now - 2 * 3600000).toISOString() },
      { id: randomUUID(), userId: id('Ayesha'), name: 'Ayesha', text: 'Hiring a junior designer at our studio ✨ DM me', bg: '#7c3aed', viewers: [], createdAt: new Date(now - 5 * 3600000).toISOString() },
      { id: randomUUID(), userId: id('Ali'), name: 'Ali', text: 'Murree on the 20th 🏔️❄️', bg: '#2f5bf5', viewers: [], createdAt: new Date(now - 9 * 3600000).toISOString() },
    ],
    sessions: [],
    chats,
    messages: lines.map(([c, sender, text, ago]) => ({
      id: randomUUID(),
      chatId: c.id,
      sender,
      senderId: sender === 'You' ? undefined : id(sender),
      text,
      createdAt: iso(ago),
    })),
  };
}
