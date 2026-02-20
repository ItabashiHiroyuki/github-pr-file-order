# Inline Reading Guide 引き継ぎドキュメント

## 現在の状態
- ブランチ: `feature/inline-reading-guide`
- HEAD: `22b51f2 fix: address self-review findings`
- **working tree は clean**（reset --hard HEAD 済み）
- stash に過去の試行が2つ残っている（参考用、使わなくてOK）

## 動いてるもの
- **line指定ありコメント**: diff テーブルの該当行の後にインラインで表示される ✅
- **line指定なし（null-line）コメント**: anchor がある（`copilot-diff-entry[data-file-path]` が DOM にある）ファイルのみ、ヘッダーバナーとして表示される ✅
- ファイル並べ替え（CSS order ベース）✅
- MutationObserver による lazy load 対応（ファイルが読み込まれると再注入）✅

## 動いてないもの（未解決の問題）
**anchor が存在しないファイルの Reading Guide が表示されない**

### 根本原因
private repo の GitHub UI で、一部のファイルが以下の状態になる:
- ファイルヘッダー（ファイル名、+N/-M、Viewed チェックボックス等）は**画面に表示される**
- しかし `copilot-diff-entry[data-file-path]` が **DOM に存在しない**
- `[data-file-path]` 属性を持つ要素が**一切ない**
- つまり `buildGuideAnchors()` がこのファイルを発見できない → anchor なし → ガイドがスキップされる

### anchors=0 になるケース
ページの初期ロード時にまだ `copilot-diff-entry` が1つも DOM に入っていない場合がある。`waitForFiles()` が5秒タイムアウトした後に `applyReadingGuide` が実行され、anchors=0 で何も表示されない。

### 確認済みの事実（private repo の PR にて）
```
document.querySelector('copilot-diff-entry[data-file-path*="xwork-output-schema"]') → null
document.querySelector('[data-file-path*="xwork-output-schema"]') → null (undefined)
```
ファイルヘッダーは画面に見えているのに、属性ベースでは一切引っかからない。

## 試みたアプローチと結果

### Round 1-3: copilot-diff-entry 内部 / 兄弟挿入
- line指定ありのインラインガイドは**兄弟挿入で解決済み**
- null-line の問題は anchor がないファイルでは解決しない

### Round 4: orphan バナーを `#files` に直接挿入
- **失敗**: private repo では `document.getElementById('files')` が `null`

### Round 5: `.js-diff-progressive-container` 内に挿入
- **失敗**: private repo では anchorParent が素の `<div>`、`#files` も存在しない

### Round 6: anchor の兄弟要素として挿入（afterend/beforebegin）
- **部分的成功**: anchor がある場合のみ動作。anchor=0 では動かない

### Round 7: null-line → line=1 にデフォルト
- **部分的成功**: anchor があるファイルでは正しく動作
- anchor がないファイルでは `if (!anchor) return` でスキップされるため無意味

### Round 8: `document.body` に固定パネル（position: fixed）
- **表示された！** が、背景が透けて読みづらい＋画面上で邪魔

### Round 9: テキスト検索（`<a>` タグ）でファイルヘッダーを見つけてインライン挿入
- **失敗**: 全部出なくなった（おそらく `findFileHeaderByText` がファイルツリーサイドバーのリンクにマッチし、diff エリア外に挿入してしまった）

## 実装すべき方針

### 最も有望なアプローチ: `buildGuideAnchors` の強化

`buildGuideAnchors()` に「テキストベースのフォールバック検索」を追加する。
guide の `fileOrder` に含まれるファイルパスのうち、`[data-file-path]` で見つからなかったものについて:

1. **`<a>` タグのテキストでファイルパスを検索**（サイドバーを除外する）
2. 見つかった `<a>` から親要素を辿り、ファイルセクションのコンテナ要素を特定
3. それを `GuideAnchor` として返す

ポイント:
- サイドバー除外: `nav` や `[data-target*="fileTree"]` 内のリンクを除外
- コンテナ特定: ファイルヘッダーの `<a>` から 2-4 階層上の、兄弟要素を持つ要素を使う
- 既存の `injectHeaderBanner` / `insertInlineGuideRow` パイプラインをそのまま活用（新しい注入関数は不要）

### 変更箇所

#### reading-guide-inject.js

1. **`buildGuideAnchors(filePaths)`** — オプションの `filePaths` 引数を追加
   - 第1パス: 既存の `[data-file-path]` 検索（変更なし）
   - 第2パス: `filePaths` のうち第1パスで見つからなかったものについて、テキスト検索でアンカーを補完

2. **`injectInlineComments`** — null-line → line=1 のデフォルト
   ```js
   if (comment.line == null || Number.isNaN(comment.line)) {
     comment.line = 1;
     comment.isFileLevel = true;
   }
   ```

3. **`insertInlineGuideRow`** — isFileLevel 時のラベル
   ```js
   label.textContent = comment.isFileLevel
     ? '📖 Reading Guide'
     : '📖 Reading Guide (' + side + line + ')';
   ```

4. **`applyReadingGuide`** — guide の fileOrder を `buildGuideAnchors` に渡す

#### content.js

1. **`lastInjectedGuideCount`** 変数追加
2. **observer.disconnect()/observe()** を `applyReadingGuide` 呼び出し前後に追加（3箇所）
3. **デバウンスハンドラ**: 条件付き再注入 + `lastKnownFileCount` 更新

### テキスト検索のサイドバー除外方法

```js
function findFileElementByText(filePath) {
  // ファイルツリーサイドバーを除外するため、diff エリア内のリンクのみ検索
  var diffArea = document.querySelector('[data-target="diff-layout.mainContainer"]')
    || document.querySelector('.diff-view')
    || document.querySelector('main')
    || document.body;

  // サイドバーコンテナ（除外対象）
  var sidebar = document.querySelector('[data-target="diff-layout.fileTreeContainer"]')
    || document.querySelector('nav[aria-label="File Tree"]');

  var links = diffArea.querySelectorAll('a');
  for (var i = 0; i < links.length; i++) {
    var link = links[i];
    // サイドバー内のリンクは除外
    if (sidebar && sidebar.contains(link)) continue;

    var text = link.textContent.trim();
    if (text === filePath || text === filePath.split('/').pop()) {
      // ファイルセクションのコンテナを辿る
      var el = link;
      while (el.parentElement && el.parentElement !== diffArea) {
        var parent = el.parentElement;
        // 兄弟要素がある = セクション区切りの可能性
        if (parent.children.length > 1) return parent;  // ← ここ要調整
        el = parent;
      }
      return link.parentElement;
    }
  }
  return null;
}
```

**注意**: 上記の「コンテナ特定」ロジックは実際の DOM 構造に依存する。
Playwright で private repo の DOM を調査して、ファイルヘッダーの実際の要素構造を確認するのが確実。

## 調査に使えるデバッグコマンド

PR の /files ページの Console で実行:

```js
// anchor の数を確認
document.querySelectorAll('[data-file-path]').length

// 特定ファイルの要素を探す
document.querySelector('[data-file-path*="TARGET_FILE"]')

// テキストでリンクを検索（サイドバー含む）
[...document.querySelectorAll('a')].filter(a => a.textContent.trim().includes('TARGET_FILE')).map(a => ({
  text: a.textContent.trim(),
  parent: a.parentElement?.tagName + '.' + a.parentElement?.className,
  inNav: !!a.closest('nav'),
  rect: a.getBoundingClientRect()
}))

// ファイルヘッダーの DOM 構造を調査
[...document.querySelectorAll('a')].find(a => a.textContent.trim() === 'TARGET_FILE')?.closest('div')?.outerHTML.slice(0, 500)
```

## ファイル構成
- `content.js` — メインの content script（並べ替え、パース、MutationObserver）
- `reading-guide-inject.js` — ガイド表示ロジック（anchor 検索、DOM 注入）
- `reading-guide-parse.js` — PR description からの Reading Order パース
- `content.css` — ガイドのスタイル
- `background.js` — .diff 取得用の service worker
