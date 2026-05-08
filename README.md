# Graber

Electronで動作する「アプリランチャー + 画面プライバシーフィルター」です。

## 開発起動

```bash
npm install
npm start
```

起動時はランチャー画面を表示せず、バックグラウンド待機します。

## 操作

- `Ctrl + Space` でランチャー表示/非表示
- `Ctrl + Shift + Space` でもランチャー表示/非表示（代替）
- `Esc` はプライバシーフィルター解除専用
- `↑` `↓` で選択移動、`Enter` で実行
- macOSでは `Command + Shift + Space` / `Control + Space` を優先利用

## 自動起動（PC起動時）

ランチャー画面の「PC起動時に自動起動する」チェックボックスでON/OFFできます。

- ON: `app.setLoginItemSettings({ openAtLogin: true, openAsHidden: true })`
- OFF: `app.setLoginItemSettings({ openAtLogin: false })`

自動起動時もウィンドウは非表示で開始し、トレイ常駐 + `Ctrl + Space` で呼び出します。

## Windows向けビルド（Exe化）

```bash
npm install
npm run build
npm run dist
```

- `npm run build`: Windows向け展開ファイルを作成（ディレクトリ出力）
- `npm run dist`: Windows向けインストーラー/実行ファイルを作成
- 生成物: `dist` フォルダ

## アイコン設定

Windowsアイコンは `build/icon.ico` を優先参照します（見つからない場合は `build/*.ico` / `build/*.png` を探索）。

- アイコンを使う場合: `build/icon.ico` を配置
- アイコン未配置でも `npm start` の開発実行は可能
- ビルド時にアイコンを使う場合は `build/icon.ico` を用意してください

## ショートカット競合

`Ctrl + Space` はIMEや他アプリと競合する場合があります。登録失敗時は `Ctrl + Shift + Space` を利用してください。

## 動作確認手順（最低限）

1. 起動確認
   - `npm start` で起動後、トレイ常駐すること
   - `Ctrl + Space`（macOSは `Command + Shift + Space`）でランチャー表示/非表示できること
2. 検索確認
   - 検索欄にアプリ名の一部を入力し、候補が絞り込まれること
   - 候補を `Enter` で起動できること
   - 任意の文字列入力で `Web検索` 項目が表示され、`Enter` で既定ブラウザが開くこと
3. フィルター確認
   - 「プライバシーフィルター ON/OFF」ボタンで状態が切り替わること
   - `Esc` でフィルター解除できること
4. トレイ確認
   - トレイメニューから「ランチャー表示」「プライバシーフィルター ON/OFF」「終了」が動作すること
5. 自動起動確認
   - ランチャー内の「PC起動時に自動起動する」ON/OFFが反映されること
   - ON後にアプリ再起動して設定が保持されること

## apps.json の書き方

`apps.json` は以下の形式です。`name` と `path` は文字列を指定してください。

```json
[
  {
    "name": "メモ帳",
    "path": "notepad.exe"
  },
  {
    "name": "電卓",
    "path": "calc.exe"
  },
  {
    "name": "VS Code",
    "path": "C:\\Users\\YourName\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe"
  }
]
```

## 自動起動がうまくいかない場合

- 開発モードより、`npm run dist` で作成した実行ファイルの方が安定します
- セキュリティソフトや会社ポリシーでログイン項目登録が制限されることがあります
- 管理者権限実行や環境差で反映が遅れる場合は、一度OFF→ONし直してください

## 注意

このフィルターは簡易的な視認性低下用で、スクリーンロック相当のセキュリティ機能ではありません。
