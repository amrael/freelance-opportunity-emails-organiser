# foe — Freelance Opportunity Emails

CLI tool that polls iCloud Mail for freelance opportunity emails from recruiters/agents, extracts structured data using LLM (AWS Bedrock or local Ollama), and stores everything in SQLite for pipeline management.

## Features

- **Auto-polling**: Fetches emails from known agent domains via IMAP
- **LLM extraction**: Parses unstructured emails into structured opportunity data (company, pay, skills, etc.)
- **Multi-opportunity splitting**: Handles emails containing multiple opportunities, splitting them into individual records
- **AI fit scoring**: Scores each opportunity against your profile (1-5)
- **Bulk update**: Paste your reply text and let AI update multiple opportunity statuses at once
- **Reply drafts**: Generate polite Japanese business email replies from brief notes
- **Telegram notifications**: Get notified when new opportunities arrive
- **Obsidian export**: Export your pipeline to markdown

## Setup

### 1. Prerequisites

- Node.js 18+
- iCloud Mail credentials (app-specific password)
- One of:
  - **AWS account** with Bedrock access (recommended — uses Qwen3 235B)
  - **Ollama** running locally with a model like `gemma3:4b`

### 2. Install

```bash
git clone https://github.com/amrael/freelance-opportunity-emails-organiser.git
cd freelance-opportunity-emails-organiser
npm install
npm link  # makes `foe` available globally
```

### 3. Configure

```bash
cp .env.example .env
# Edit .env with your credentials and preferences
```

#### iCloud Mail credentials

Create `~/.openclaw/icloud_mail.json`:

```json
{
  "user": "your-apple-id@icloud.com",
  "password": "your-app-specific-password",
  "host": "imap.mail.me.com",
  "port": 993,
  "tls": true
}
```

Generate an app-specific password at [appleid.apple.com](https://appleid.apple.com/).

### 4. Cron (optional)

```bash
# Poll every hour from 8am to 11pm
crontab -e
0 8-23 * * * /usr/local/bin/node /path/to/foe/bin/foe poll >> /path/to/foe/logs/poll.log 2>&1
```

## Usage

```bash
# Poll for new emails
foe poll

# List opportunities
foe list                          # Active only
foe list --all                    # Include dismissed/declined
foe list --status 検討中          # Filter by status
foe list --min-pay 60             # Minimum 60万/month

# View details
foe show <id>

# Update status
foe status <id> エントリー済
foe status <id> 辞退 --note "条件が合わない"
foe dismiss <id>                  # Not an opportunity

# Add notes
foe note <id> "面談で好印象"

# Bulk update from free text
echo "A社はエントリー、B社は辞退" | foe update
foe update --dry-run "テキスト"   # Preview only

# Generate reply draft
foe reply <id> --note "条件OK、面談希望"
foe reply <id> --show

# Follow-up reminder
foe followup <id> --date 2026-04-01 --action "返信する"

# Export & stats
foe export
foe stats
```

### Status flow

```
新着 → 検討中 → エントリー済 → 面談済 → 成約
                           ↘ 辞退
対象外（not an opportunity）
```

## Architecture

```
bin/foe              CLI entry point, .env loader
src/
  imap.js            IMAP polling, domain filtering
  extractor.js       LLM extraction (Bedrock Qwen3 / Ollama)
  notify.js          Telegram notifications
  db.js              SQLite schema & migrations
  commands/
    poll.js          Fetch & extract new emails
    list.js          List opportunities
    show.js          Show opportunity details
    status.js        Update status
    update.js        Bulk update from free text
    note.js          Add notes
    reply.js         Generate reply drafts
    followup.js      Set follow-up reminders
    export.js        Obsidian markdown export
    stats.js         Statistics
data/
  opportunities.db   SQLite database (gitignored)
```

## LLM Backends

| Backend | Model | Speed | Quality | Cost |
|---------|-------|-------|---------|------|
| **Bedrock** (default) | Qwen3 235B | ~10s | Excellent | ~$0.01/email |
| Ollama (fallback) | gemma3:4b | ~30s | Adequate for single-opportunity emails | Free |

Set `FOE_EXTRACTOR=ollama` in `.env` to use Ollama only. Bedrock automatically falls back to Ollama on failure.

## License

MIT
