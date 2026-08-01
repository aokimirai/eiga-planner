# 神奈川シネマプランナー

神奈川県内の映画館の上映情報を横断表示し、観たい映画を1〜3本選ぶと移動時間を考慮したベストな映画館・上映時間の組み合わせを提案するWebアプリ。

- 上映情報の出典: [映画.com（神奈川県の映画館）](https://eiga.com/theater/14/)
- データは GitHub Actions が1日2回自動取得し、`data/theaters.json` / `data/screenings.json` を更新
- 映画館間の移動時間は `data/travel.json` に手動でまとめた概算の駅間所要時間 + 徒歩時間から算出（実際の交通機関の運行状況とは異なる場合があります）
- フロントエンドはビルド不要の素のHTML/CSS/JS。GitHub Pages でそのまま公開可能

## 開発

```bash
npm install
npm run scrape   # data/theaters.json, data/screenings.json を再生成
python3 -m http.server 4173   # ローカルで動作確認
```

## 免責事項

上映情報は自動取得したものであり、変更や誤りが含まれる可能性があります。ご来場前に必ず各映画館の公式情報をご確認ください。
