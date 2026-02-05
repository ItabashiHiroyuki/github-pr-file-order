# GitHub PR File Order

GitHub PRの「Files changed」タブでファイルの表示順序をカスタマイズするChrome拡張。

## 機能

- **ファイル順序のカスタマイズ**: ドラッグ&ドロップでファイルの表示順序を変更
- **PR descriptionからパース**: `## Reading Order` セクションから自動的に順序を取得
- **自動保存**: PR毎にlocalStorageに保存、次回アクセス時に自動適用
- **自動適用**: 保存された順序でファイルを自動的に並び替え

## インストール

1. このリポジトリをクローン
2. Chrome で `chrome://extensions/` を開く
3. 「デベロッパーモード」を有効化
4. 「パッケージ化されていない拡張機能を読み込む」をクリック
5. このリポジトリのフォルダを選択

## 使い方

### 手動で並び替え

1. GitHub PRの「Files changed」タブを開く
2. 拡張機能のアイコンをクリック
3. ドラッグ&ドロップでファイルを並び替え
4. 「Apply Order」をクリック

### PR descriptionから読み込み

PR作成時に以下の形式で記述:

```markdown
## Reading Order
1. src/pages/api/handler.ts
2. src/services/MyService.ts
3. src/utils/helper.ts
```

拡張機能ポップアップで「Parse from PR」をクリックすると自動的に順序を取得。

## 推奨ワークフロー

PRを作成する際、レビュアーが読みやすい順序（handler → service → repository → utils）で `## Reading Order` セクションを記述。

Claude Codeで順序を生成する場合:
```
このPRのファイルをhandlerから詳細への流れで並べて、Reading Order形式で出力して
```
