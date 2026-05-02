# foe — Claude Code 向け作業メモ

仕様・セットアップ手順は `README.md` を参照。このファイルは Claude Code でこのリポジトリを触るときに意識すべき点だけまとめる。

## 公開リポジトリであることへの注意

GitHub に公開しているので、コミット前に以下が混入していないか必ず確認する:

- `.env`、AWS / iCloud のクレデンシャル
- 実在の企業名・担当者名・報酬額を含むメール本文や `custom_reply_prompt.txt` のような個人プロンプト
- `data/opportunities.db`（実案件データそのもの）や `logs/poll.log`

これらは `.gitignore` でブロック済み。新しい個人データを置くファイルを増やすときは `.gitignore` も同時に更新すること。

## 運用環境

- 開発環境がそのまま本番環境（macOS 上のローカル CLI ＋ cron）。`npm link` で `foe` をグローバルに配置する想定。
- SQLite DB (`data/opportunities.db`) は運用中の本番データ。スキーマ変更時は `src/db.js` のマイグレーションブロックに追記する形で対応し、既存レコードを壊さないこと。実験前に `cp data/opportunities.db data/opportunities.db.bak` でバックアップを取る。
- iCloud 認証情報はリポジトリ外の `~/.openclaw/icloud_mail.json` に置く。

## コーディング上の取り決め

- CLI 出力・ログ・エラーメッセージ・コメントは原則日本語。
- ステータスは DB に文字列リテラルで保存される固定セット: `新着 / 検討中 / エントリー済 / 面談済 / 辞退 / アンマッチ / 成約 / 対象外`。新しいステータスを足すときは `src/db.js` の `CHECK` 制約とマイグレーションを両方更新する。
- `bin/foe` で `.env` を手動ロードしてからサブコマンドへ dispatch している。新しいサブコマンドを追加するときは `bin/foe` の dispatcher と `src/commands/<name>.js` の両方に手を入れる。
- LLM 抽出は Bedrock (Qwen3 235B) が primary、Ollama が fallback (`src/extractor.js`)。プロンプトを変えるときは両 backend で結果を確認する。

## テスト

自動テストは無い。動作確認は実 IMAP / 実 DB を使う前提。破壊的な変更を試すときは DB バックアップを取り、影響範囲が大きい場合は `--dry-run` がある CLI（例: `foe update`）でまず確認する。
