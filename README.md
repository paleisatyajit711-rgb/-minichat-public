# MiniChat — public two-person chat app

A small, deployable real-time chat application. Users register with email/password, choose a unique username, find another user, and exchange text and image messages. It includes online/offline presence, typing indicators, and saved message history.

## Architecture

- **Node.js + Express** serves the frontend and Socket.IO server.
- **Socket.IO** delivers live messages, presence, and typing events.
- **Supabase Auth** handles account creation and login.
- **Supabase Postgres** stores profiles and message history with Row Level Security.
- **Supabase Storage** stores images (public bucket, maximum 5 MB).

This is a learning/demo app. It is not end-to-end encrypted. Uploaded image links are public. Do not use it for sensitive conversations or private images.

## 1. Create Supabase project

1. Create a project at https://supabase.com/.
2. Open **SQL Editor** and run all contents of `schema.sql`.
3. Open **Project Settings → API** and copy the Project URL and `anon` / publishable key.
4. In **Authentication → Providers → Email**, enable email/password.
5. For quick testing, you may turn off email confirmation in **Authentication → Providers → Email**. For a public app, keep email confirmation enabled and configure SMTP/email delivery.
6. In **Authentication → URL Configuration**, add your deployed app URL to Site URL and Redirect URLs.

Never put a Supabase `service_role` key in the browser or this project. The anon key is designed for frontend use with RLS enabled.

## 2. Configure locally

Requirements: Node.js 20 or newer.

```bash
npm install
cp .env.example .env
```

Edit `.env`:
- `SUPABASE_URL`: your Supabase Project URL
- `SUPABASE_ANON_KEY`: your anon/publishable key
- `APP_ORIGIN`: `http://localhost:3000`

Then edit `public/app.js` and replace:
- `https://YOUR_PROJECT.supabase.co`
- `YOUR_SUPABASE_ANON_KEY`

Use the same Supabase URL and anon key in both places. Do not commit `.env`.

## 3. Run locally

```bash
npm start
```

Open http://localhost:3000 in two different browsers or devices. Create two accounts with different usernames. Search for the other username and start chatting.

## 4. Publish publicly on Render

1. Create a GitHub account/repository and upload this project (do not upload `.env` or `node_modules`).
2. Sign in to https://render.com/ and choose **New → Web Service**.
3. Connect the GitHub repository.
4. Set:
   - Runtime: Node
   - Build command: `npm install`
   - Start command: `npm start`
5. Add environment variables:
   - `SUPABASE_URL` = your Supabase project URL
   - `SUPABASE_ANON_KEY` = your Supabase anon/publishable key
   - `NODE_ENV` = `production`
   - `APP_ORIGIN` = your Render URL, e.g. `https://your-app.onrender.com`
6. Deploy. Render will provide a public HTTPS URL.
7. In Supabase **Authentication → URL Configuration**, set Site URL to your Render URL and add it to Redirect URLs.
8. Open the public URL on two devices, create accounts, and test messages, images, presence, and typing.

Render free instances may sleep when idle and can take time to wake. For a dependable always-on chat, use a paid instance. Socket.IO presence is held in server memory, so this single-instance starter should be deployed as one instance (do not scale horizontally without adding a shared Socket.IO adapter/presence store).

## 5. How to test

- Create User A and User B using different email addresses.
- Search for each other's usernames.
- Send text in both directions.
- Upload a small JPG/PNG/WebP/GIF.
- Keep both users online and check status/typing.
- Close one browser and confirm the other sees offline status.
- Refresh and confirm messages remain in history.

## Security and production notes

- Database Row Level Security restricts message history to the two participants.
- The server validates each Socket.IO connection against Supabase Auth.
- Never expose service-role keys.
- The image bucket is public by design for straightforward sharing. Anyone with an image URL may view it. For private media, switch to a private bucket and implement signed URL delivery.
- Add CAPTCHA, email verification, abuse reporting, blocking, stronger rate limits, and moderation before opening this to a large public audience.
- This starter is not WhatsApp, does not provide end-to-end encryption, and should not be represented as such.
