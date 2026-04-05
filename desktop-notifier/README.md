# FixPulse Desktop Notifier

Small Electron companion app for FixPulse assignment notifications.

## Features

- stays signed in after first login
- polls the FixPulse server for assignment notifications
- shows desktop toast notifications for newly assigned issues
- unread notification count
- mute / unmute sound
- falls back to login screen automatically if the saved session becomes invalid

## Run

```bash
cd desktop-notifier
npm install
npm start
```

Default server URL is `http://localhost:3000`.
