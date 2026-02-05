# PR作成スキル（Reading Order付き）

PRを作成する際に、レビュアーが読みやすい順序（Reading Order）を自動的に含める。

## 手順

### 1. 変更内容の把握

```bash
git status
git diff develop...HEAD --name-only
git log develop..HEAD --oneline
```

### 2. Reading Orderの決定

変更されたファイルを以下の優先順位で並べる：

1. **Handler / Controller / Entrypoint** - リクエストの入口
2. **Service** - ビジネスロジック
3. **Repository / Data Access** - データアクセス層
4. **Domain / Model** - ドメインロジック
5. **Components / View** - UIコンポーネント
6. **Hooks** - カスタムフック
7. **Utils / Helpers** - ユーティリティ
8. **Types / Constants / Config** - 型定義・定数・設定

**テストファイルの配置ルール:**
- テストファイル（`*.test.ts`, `*.test.tsx`）は対応する実装ファイルの**直後**に配置
- 例: `UserService.ts` → `UserService.test.ts` の順

同じカテゴリ内では、依存関係の上流から下流の順に並べる。

### 3. PR作成

以下の形式でPRを作成：

```markdown
## Summary
- 変更内容の要約（箇条書き）

## Reading Order
1. path/to/handler.ts
2. path/to/Service.ts
3. path/to/Service.test.ts
4. path/to/helper.ts

## Test plan
- [ ] テスト項目

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

### 4. コマンド実行

```bash
gh pr create --title "タイトル" --body "$(cat <<'EOF'
## Summary
...

## Reading Order
1. ...
2. ...

## Test plan
...

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

## 例

変更ファイル:
- `createUser.controller.ts`
- `UserService.ts`
- `UserService.test.ts`
- `sendNotification.ts`
- `sendNotification.test.ts`
- `config.ts`

Reading Order:
```markdown
## Reading Order
1. src/controllers/createUser.controller.ts
2. src/services/UserService.ts
3. src/services/UserService.test.ts
4. src/services/notifications/sendNotification.ts
5. src/services/notifications/sendNotification.test.ts
6. src/constants/config.ts
```

## 注意事項

- ファイル数が3つ以下の場合はReading Orderを省略可
- 小さな変更（定数の修正のみなど）もReading Orderを省略可
