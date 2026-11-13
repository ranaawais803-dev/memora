# Weave

A messaging app that works like WhatsApp and keeps things organized for you.
**Chat the way you already do. Everything else happens in the background.**

| Feature | What the user sees |
|---|---|
| **Smart Library** | Each photo, video, voice note and file is sorted into a folder named by AI from the chat's context, for example `Trip to Murree` or `Receipts`. Folders are grouped by year and mirrored to Google Drive as `Weave/<Chat>/<Year>/<Folder>/`. |
| **Keeps / Plans** | Things not to forget ("Buy milk") and things the group agreed on ("Dinner Friday 8pm"). Tap to tick them off. |
| **Good to know** | Useful facts pulled from the chat: booking numbers, addresses, recipes. |
| **Topics** | Short theme tags like `#Vacation` and `#Football`. |
| **Summary** | Today, this week, this month and this year, in plain words. |
| **Catch up** | One tap summarizes the last 30 messages. |
| **Voice notes** | Transcribed live in the browser and searchable. Time-sensitive notes get an **Urgent** banner. |
| **Universal search** | One search box covers messages, voice transcripts, photo captions, Keeps, Plans and facts. |
| **Drive notes** | Each chat folder in Drive gets a `Weave Notes` Google Doc with the summaries, Keeps, Plans and facts. |

There is no AI chat panel. The AI only shows up as organization and search.

## Stack
- **server/**: NestJS 10, Socket.IO for realtime, Claude (`@anthropic-ai/sdk`, structured outputs), Google Drive (`googleapis`), and a JSON file database in `server/data/`.
- **web/**: React 19, Vite, Tailwind CSS v4, lucide icons.
- **Transcription**: the browser's built-in Web Speech API (Chrome, Edge and Safari). It is free and needs no key.

## Run
```bash
npm install
npm run install:all
cp server/.env.example server/.env   # optional keys, see below
npm run dev                          # API on :3000, web on http://localhost:5173
```
The app starts with two demo chats. Without any keys it runs in **Basic mode**, which uses keyword rules.

### Smarter organizing with Claude
Set `ANTHROPIC_API_KEY` in `server/.env`. The default model is `claude-opus-5-5`. To lower costs, set `AI_MODEL=claude-haiku-5-5`.

### Google Drive
1. In Google Cloud Console, create a project, enable the **Google Drive API**, then go to **Credentials** and create an **OAuth client ID** of type *Web application*.
2. Add `http://localhost:3000/api/drive/callback` as an authorized redirect URI.
3. Put the client ID and secret in `server/.env`, restart, and click **Connect Drive** in the app.

Weave uses the `drive.file` scope, so it can only see files it created.
