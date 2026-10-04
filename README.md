# AI Usage Dashboard - PC Free Cloud Sync

`https://ussiy-buiz.github.io/` で、ChatGPT/Codex の5時間枠・週間枠をPCなしで確認するPWAです。

## 仕組み

1. 2. ChatGPT認証のrefresh tokenは `USAGE_AUTH_KEY` でAES-256-GCM暗号化し、`usage-cloud-state` ブランチの `private-auth.enc` に保存します。
3. 利用枠履歴は別鍵 `USAGE_VIEW_KEY` で暗号化し、同ブランチの `usage-data.enc` に保存します。
4. GitHub Pagesは `usage-data.enc` を読み、iPhone内に保存した表示キーで復号します。
5. PC、Chrome/Edge拡張、ChatGPT Usage画面の常時起動は不要です。

## 初回セットアップ（iPhoneだけでも可能）

1. GitHub Pagesを開き「セットアップキーを生成」。
2. GitHub repository Settings → Secrets and variables → Actions に以下2つを登録。
   - `USAGE_AUTH_KEY`: 生成されたAUTHキー
   - `USAGE_VIEW_KEY`: 生成されたVIEWキー
3. GitHub Pagesに戻り、VIEWキーを「表示キー」として保存。
4. Actions → `Cloud Usage Sync` → Run workflow → `bootstrap`。
5. GitHub Pagesに戻ると、暗号化されたbootstrap状態からワンタイムコードが表示されるので、表示されたリンクからChatGPTで承認。
6. 次回の定期同期（通常5分以内）が認証完了を検出し、以後は自動でUsageを取得。

`USAGE_AUTH_KEY` はブラウザには保存しません。公開リポジトリに平文のOpenAIトークンを置かない設計です。

## 注意

- Usage取得はOpenAI公式Codexのオープンソース実装が利用する認証/Usage経路に合わせていますが、Web APIの仕様変更で将来修正が必要になる可能性があります。
- GitHub Actionsのcronは厳密な5分タイマーではなく、混雑時は遅延することがあります。
- Actionsが401/認証エラーになった場合は `bootstrap` を再実行します。


## On-demand refresh

The dashboard no longer uses a scheduled cron. Usage is refreshed only when the PWA is opened or when the user taps "今すぐ表示更新".

To trigger the workflow from iPhone without exposing repository secrets, create a GitHub fine-grained personal access token restricted to this repository with **Actions: Read and write** only, then save it once in the PWA. The token is stored only in that browser's localStorage and is never committed to the repository.

The app dispatches `.github/workflows/usage-sync.yml` with mode `sync`, polls the encrypted `usage-data.enc` state, and updates the UI when a newer capture appears.
