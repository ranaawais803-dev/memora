import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import * as z from 'zod/v4';
import * as fs from 'fs';
import { randomUUID } from 'crypto';
import { Chat, Item, Media, Message, Period } from './store';

const MODEL = process.env.AI_MODEL || 'claude-opus-5-5';

const ItemSchema = z.object({
  text: z.string(),
  when: z.string().describe('Date/time if mentioned, else empty string'),
  assignee: z.string().describe('Exact chat member name responsible ("Ali please book" -> Ali, "I will get them" -> the sender), else empty string'),
  due: z.string().describe('Deadline as YYYY-MM-DD if it can be worked out from the messages and today, else empty string'),
  sources: z.array(z.number().int()).describe('The #numbers of the messages this came from: the message that raised it plus any that confirmed, changed or added detail to it'),
  notes: z.string().describe(
    'Short helpful context taken ONLY from the linked messages (who asked, where, booking numbers, follow-up changes). ' +
      'E.g. hotel plan -> "Pearl Continental, 2 rooms, confirmation PC-88213". Empty string if the title already says it all. Never invent details.',
  ),
  done: z.boolean().describe('True only if a later message clearly shows it was already done ("Booked it", "Got the milk"). For plans: false unless it already happened.'),
  list: z.array(z.string()).describe(
    'For keeps AND plans: the smaller pieces that belong to this item, gathered from EVERY message about it, not just the first one. ' +
      'Includes: several things named at once ("buy milk and eggs" -> ["Milk", "Eggs"]); replies to it ("↪ replying to #n" pointing at one of its messages); ' +
      'and work handed out for it, even in a later message that is not a reply ("Ali can you book the hotel for the trip?" -> plan "Murree trip" gets "Book hotel (Ali)"). ' +
      'Put the person in brackets when someone is asked or offers to do a piece, and the day when one is given: "Book hotel (Ali, Fri)". ' +
      'Empty array when there is only one thing to do. Always empty for knowledge.',
  ),
});

type Extracted = { text: string; when: string; assignee?: string; due?: string; sources?: number[]; notes?: string; list?: string[]; done?: boolean };
const isDate = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

const InsightsSchema = z.object({
  keeps: z.array(ItemSchema).describe('Things not to forget: errands, reminders, to-dos ("Buy milk", "Renew passport")'),
  plans: z.array(ItemSchema).describe('Things the group agreed on or is deciding: events, bookings, choices ("Dinner Friday 8pm", "Pick the hotel for Murree"). A choice still open goes here too, with the options in its list.'),
  topics: z.array(z.string()).describe(
    'Be strict: usually 0-3. A topic is a 1-3 word theme (e.g. "Murree Trip", "Wedding Prep", "Exam Notes") ONLY when it is a real, ongoing ' +
      'conversation: discussed across several messages (normally 4+, ideally by more than one person), and worth finding again later because it holds ' +
      'decisions, important details or useful knowledge. Never create a topic for greetings, small talk, jokes, a single question or a one-off errand ' +
      '(those are Keeps/Plans, not Topics). Return an empty array if nothing qualifies, which is normal for short or casual chats.',
  ),
  topicNotes: z.array(z.object({ topic: z.string(), about: z.string() })).describe(
    'One entry per topic above (same name): about = 1-2 plain sentences on what this chat said about it: the key decisions, details and where it stands now. Use names, never guess gender.',
  ),
  knowledge: z.array(ItemSchema).describe('Useful facts worth finding later: addresses, booking numbers, recipes, contacts'),
  summaries: z.object({
    today: z.string(),
    week: z.string(),
    month: z.string(),
    year: z.string(),
  }).describe(
    'Friendly 1-3 sentence summary of messages in each window. Empty string if no messages in that window. ' +
      'Zoom out as the window grows: "today" gives specifics, "week" the main threads, "month" and "year" the bigger picture (recurring themes, what got decided). ' +
      'If a longer window contains exactly the same messages as a shorter one, return an empty string for it rather than repeating.',
  ),
});

const RecapSchema = z.object({
  headline: z.string().describe('One line like "3 plans confirmed · 2 new reminders · 1 urgent voice note"'),
  points: z.array(z.string()).describe('At most 3 short bullet points of what happened'),
});

const MediaSchema = z.object({
  category: z.string().describe('Short folder name (1-3 words, Title Case) grouping this file by what it is about, e.g. "Trip to Murree", "Receipts", "Football", "Documents"'),
  caption: z.string().describe('One sentence describing the file, used for search'),
});

const UrgentSchema = z.object({
  urgent: z.boolean().describe('True only for time-sensitive requests: deadlines today, "call me now", emergencies'),
  summary: z.string().describe('One-line summary of what is needed'),
});

const SYSTEM =
  'You quietly organize a family/friends messaging app called Weave. Use warm, plain consumer language (never corporate words like "action item"). ' +
  'Write items short, like a friend would ("Buy milk tomorrow", "Trip to Murree on the 14th"). Never invent facts not in the messages. ' +
  "Never guess anyone's gender: refer to people by name, or use \"they\". " +
  'Group follow-ups under the item they belong to instead of making new items: a reply to a keep/plan message, a piece of work handed out for a plan, ' +
  'or a later message that clearly adds to it (a change of time, a booking number, who brings what) goes into that item\'s list or notes, and its #number into its sources. ' +
  'Reactions count as replies: 👍/👌/❤️ on a plan means that person agreed or is in (say so in notes), ✅ on a keep means it was done. ' +
  'Lines like "marked “X” as done" or "said yes to “X”" are app notes about an existing item: never make new items from them. ' +
  'Only make a new item when it is truly a separate thing. When any of those messages gives a date or deadline, set when/due from it.';

@Injectable()
export class AiService {
  private log = new Logger('AI');
  private client = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN ? new Anthropic() : null;

  get enabled() {
    return !!this.client;
  }

  private async ask<T extends z.ZodType>(schema: T, content: Anthropic.Beta.BetaContentBlockParam[] | string): Promise<z.infer<T> | null> {
    if (!this.client) return null;
    try {
      const res = await this.client.beta.messages.parse({
        model: MODEL,
        max_tokens: 16000,
        system: SYSTEM,
        output_config: { effort: 'low', format: betaZodOutputFormat(schema) },
        // If a safety classifier declines, retry on a fallback model chosen by the API.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        messages: [{ role: 'user', content }],
      } as any);
      if (res.stop_reason === 'refusal') return null;
      return (res.parsed_output as z.infer<T>) ?? null;
    } catch (e: any) {
      this.log.warn(`Claude call failed: ${e?.message}`);
      return null;
    }
  }

  // ---------- Keeps / Plans / Topics / Knowledge / Summaries ----------
  async analyze(chat: Chat, msgs: Message[]) {
    const now = new Date();
    const window = msgs.slice(-400);
    // number each line so the AI can point back to the exact messages an item came from
    const pos = new Map(window.map((m, i) => [m.id, i]));
    const transcript = window.map((m, i) => `#${i} ${m.replyToId && pos.has(m.replyToId) ? `↪ replying to #${pos.get(m.replyToId)} ` : ''}${fmt(m)}`).join('\n');
    const idsFor = (nums?: number[]) => [...new Set((nums ?? []).map((n) => window[n]?.id).filter(Boolean) as string[])];
    const ai = await this.ask(
      InsightsSchema,
      `Today is ${now.toDateString()}. Chat "${chat.name}" (members: ${chat.members.join(', ')}).\n` +
        `"today" = since midnight, "week" = last 7 days, "month" = last 30 days, "year" = last 365 days.\n\nMessages:\n${transcript}`,
    );
    const result = ai ?? heuristicInsights(window);
    // Keep the user's work: checkmarks, notes, lists, manual and edited items all survive re-analysis.
    const dismissed = new Set(chat.insights.dismissed ?? []);
    const memberOf = (name?: string) => chat.members.find((m) => m.toLowerCase() === name?.toLowerCase());
    const merge = (fresh: Extracted[], old: Item[], withList: boolean): Item[] => {
      const pinned = old.filter((o) => o.source === 'manual' || o.edited);
      const out: Item[] = [];
      for (const f of fresh) {
        const key = f.text.toLowerCase();
        const sourceIds = idsFor(f.sources);
        if (dismissed.has(key)) continue;
        // the user edited this one: leave their version, but keep its link to the chat up to date
        const mine = pinned.find((p) => p.origin === key || p.text.toLowerCase() === key);
        if (mine) {
          if (sourceIds.length) mine.sourceIds = [...new Set([...(mine.sourceIds ?? []), ...sourceIds])];
          continue;
        }
        const prev = old.find((o) => (o.origin ?? o.text.toLowerCase()) === key);
        const fromChat = withList ? (f.list ?? []).filter((t) => t.trim()) : [];
        out.push({
          ...prev,
          id: prev?.id ?? randomUUID(),
          text: f.text,
          when: f.when || undefined,
          assignee: prev?.assignee ?? memberOf(f.assignee),
          due: prev?.due ?? (isDate(f.due) ? f.due : undefined),
          notes: f.notes?.trim() || prev?.notes || undefined,
          // the user's own tick (or untick) always wins; otherwise trust the chat ("Booked it!")
          done: prev?.done ?? (f.done || undefined),
          skipped: prev?.skipped,
          // reuse existing list items (and their ticks) when the AI names the same things again
          subtasks: fromChat.length
            ? fromChat.map((t) => prev?.subtasks?.find((s) => s.text.toLowerCase() === t.toLowerCase()) ?? { id: randomUUID(), text: t })
            : prev?.subtasks,
          sourceIds: sourceIds.length ? sourceIds : prev?.sourceIds,
          source: 'ai',
          origin: key,
          createdAt: prev?.createdAt ?? now.toISOString(),
        });
      }
      return [...out, ...pinned];
    };
    chat.insights = {
      keeps: merge(result.keeps, chat.insights.keeps, true),
      plans: merge(result.plans, chat.insights.plans, true),
      knowledge: merge(result.knowledge, chat.insights.knowledge, false),
      // short chats don't have topics yet, however eager the model is
      // people's own topics always stay; removed ones never come back
      topics: [...new Map([...(chat.insights.manualTopics ?? []), ...(msgs.length < 8 ? [] : result.topics.slice(0, 5))].map((t) => [t.toLowerCase(), t])).values()]
        .filter((t) => !(chat.insights.dismissedTopics ?? []).includes(t.toLowerCase())),
      topicNotes: { ...chat.insights.topicNotes, ...Object.fromEntries((result.topicNotes ?? []).map((t) => [t.topic, t.about])) },
      manualTopics: chat.insights.manualTopics,
      dismissedTopics: chat.insights.dismissedTopics,
      summaries: result.summaries,
      dismissed: chat.insights.dismissed,
      firstAt: msgs[0]?.createdAt,
      updatedAt: now.toISOString(),
      analyzedCount: msgs.length,
    };
    return chat.insights;
  }

  // ---------- 30-message catch-up ----------
  async recap(chat: Chat, msgs: Message[]) {
    const last = msgs.slice(-30);
    const ai = await this.ask(RecapSchema, `Catch me up on the last ${last.length} messages of "${chat.name}":\n${last.map(fmt).join('\n')}`);
    if (ai) return ai;
    const h = heuristicInsights(last);
    const urgent = last.filter((m) => m.urgent).length;
    return {
      headline: `${h.plans.length} plans · ${h.keeps.length} reminders${urgent ? ` · ${urgent} urgent voice note` : ''}`,
      points: last.slice(-3).map((m) => `${m.sender}: ${m.text || m.transcript || m.media?.name}`),
    };
  }

  // ---------- Smart Library: decide which folder a file belongs in ----------
  async classifyMedia(chat: Chat, media: Media, filePath: string, recent: Message[]) {
    const context = recent.slice(-15).map(fmt).join('\n');
    const blocks: Anthropic.Beta.BetaContentBlockParam[] = [];
    const isImg = media.kind === 'image' && /jpeg|png|gif|webp/.test(media.mime) && media.size < 4_500_000;
    if (isImg) {
      blocks.push({ type: 'image', source: { type: 'base64', media_type: media.mime as any, data: fs.readFileSync(filePath).toString('base64') } });
    }
    blocks.push({
      type: 'text',
      text: `A ${media.kind} named "${media.name}" was shared in chat "${chat.name}". Existing folders: ${existingCategories(recent).join(', ') || 'none'} (reuse one if it fits).\nRecent conversation:\n${context}`,
    });
    const ai = await this.ask(MediaSchema, blocks);
    return ai ?? { category: defaultCategory(media), caption: media.name };
  }

  // ---------- Urgent voice detection ----------
  async urgency(transcript: string) {
    if (!transcript.trim()) return null;
    const ai = await this.ask(UrgentSchema, `Voice note transcript: "${transcript}"`);
    const urgent = ai ? ai.urgent : /\b(urgent|asap|right now|call me|today before|emergency|immediately)\b/i.test(transcript);
    return urgent ? { summary: ai?.summary || transcript.slice(0, 120) } : null;
  }
}

const fmt = (m: Message) =>
  `[${m.createdAt.slice(0, 16).replace('T', ' ')}] ${m.sender}: ${m.text}${m.transcript ? ` (voice: "${m.transcript}")` : ''}${m.media ? ` [${m.media.kind}: ${m.media.caption || m.media.name}]` : ''}${m.reactions?.length ? ` [reactions: ${m.reactions.map((r) => `${r.emoji} ${r.name}`).join(', ')}]` : ''}`;

const existingCategories = (msgs: Message[]) => [...new Set(msgs.map((m) => m.media?.category).filter(Boolean) as string[])];

export const defaultCategory = (m: Media) => ({ image: 'Photos', video: 'Videos', audio: 'Voice Notes', file: 'Documents' })[m.kind];

/** Rough keyword-based fallback so the app still works without an API key. */
function heuristicInsights(msgs: Message[]) {
  const now = Date.now();
  const keeps: Extracted[] = [];
  const plans: Extracted[] = [];
  const knowledge: Extracted[] = [];
  const topicHits = new Map<string, number>(); // a theme only counts as a topic once it keeps coming up
  const topicWords: Record<string, string> = { trip: 'Vacation', hotel: 'Vacation', football: 'Football', movie: 'Movies', dinner: 'Food', recipe: 'Recipes', school: 'School', exam: 'School' };
  for (const [i, m] of msgs.entries()) {
    const t = `${m.text} ${m.transcript ?? ''}`.trim();
    if (/\b(buy|call|renew|don'?t forget|remember|pick up|pay|need to)\b/i.test(t)) keeps.push({ text: t, when: '', sources: [i] });
    if (/\b(let'?s|booked|it is|count me in|i'?m in|at \d{1,2}\s?(am|pm)|friday|saturday|sunday|tomorrow)\b/i.test(t)) plans.push({ text: t, when: '', sources: [i] });
    if (/\b(no\.|number|address|code|confirmation)\b/i.test(t)) knowledge.push({ text: t, when: '', sources: [i] });
    for (const topic of new Set(Object.entries(topicWords).filter(([w]) => t.toLowerCase().includes(w)).map(([, tp]) => tp))) topicHits.set(topic, (topicHits.get(topic) ?? 0) + 1);
  }
  const within = (days: number) => msgs.filter((m) => now - +new Date(m.createdAt) < days * 86400000);
  const sum = (list: Message[]) => (list.length ? `${list.length} messages from ${[...new Set(list.map((m) => m.sender))].join(', ')}. Latest: "${list.at(-1)!.text || 'media'}"` : '');
  const summaries: Record<Period, string> = { today: sum(within(1)), week: sum(within(7)), month: sum(within(30)), year: sum(within(365)) };
  return { keeps, plans, knowledge, topicNotes: [] as { topic: string; about: string }[], topics: [...topicHits].filter(([, n]) => n >= 4).map(([tp]) => tp), summaries };
}
