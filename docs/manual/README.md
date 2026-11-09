# 操作マニュアル(GitHub Pages)

公開先: https://chikaraction.github.io/salon-booking-liff/

`docs/` を GitHub Pages(main ブランチの `/docs`、Jekyll)で公開している。サイトに入るのは
`docs/index.md` と `docs/manual/` だけで、設計文書などは `docs/_config.yml` の `exclude` で外している。
テーマは Just the Docs(`remote_theme`)。

- ページ: `docs/manual/customer/`(お客様の操作)、`docs/manual/admin/`(管理画面)、`docs/manual/faq.md`
- 画像: `docs/manual/images/`(手元の Supabase とダミーデータで撮影。店名・人名は架空)
- 画像のパスは `{{ '/manual/images/xxx.png' | relative_url }}` で書く(ページの URL は `permalink` で決まるため、相対パスは使わない)
- 画面を変えたら、マニュアルの文言とスクリーンショットも合わせて直す

## 手元で確認する

GitHub Pages と同じ版(`github-pages` gem)で、Docker を使ってビルドする。リポジトリのフォルダで実行する。

```sh
docker run --rm -v "$PWD/docs:/site" -w /site -p 4000:4000 ruby:3.3.4 \
  sh -c 'gem install github-pages -v 232 --no-document >/dev/null && jekyll serve --host 0.0.0.0 --baseurl /salon-booking-liff'
```

http://localhost:4000/salon-booking-liff/ で開く。
