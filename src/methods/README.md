# WordPress plugin detection methods

This directory holds **methods, not data**. No plugin list, no slugs, no target sets:
only the shapes of evidence a WordPress site leaves behind, and code that turns them
into `(plugin directory, version)` pairs.

## Why it is not 200 more technology entries

Wappalyzer already knows how to declare "look at these script URLs, pull the version
out of capture group 1":

```json
"scriptSrc": ["/wp-content/plugins/woocommerce/.*\\?ver=([\\d.]+)\\;version:\\1"]
```

That works for one technology. WordPress ships dozens of them per page, and the same
three shapes repeat for every one:

| shape           | example                                                          | what it gives                     |
| --------------- | ---------------------------------------------------------------- | --------------------------------- |
| asset path      | `/wp-content/plugins/js_composer/assets/…`                       | plugin presence                   |
| cache-buster    | `…?ver=7.9`                                                      | plugin version                    |
| readme          | `/wp-content/plugins/js_composer/readme.txt` → `Stable tag: 7.9` | authoritative version             |
| response header | `X-Powered-By: wpCache/1.2.3`                                    | product + version, no path at all |

Copying those regexes per technology has two problems:

1. the copy cannot resolve `js_composer` to `WPBakery`, because the directory is not
   the technology name and no single rule can encode that mapping;
2. a page that ships a concatenated bundle (cache plugin) has neither a plugin path
   nor a per-plugin `?ver`, and every technology-specific rule misses at once.

So the shapes live here as functions, and the mapping step (directory → technology)
is left to whatever resolver the caller already has.

## API

```js
const wp = require('./wp-plugins');

wp.detectPlugins(html, {
  headers, // object or Headers instance
  readme: (dir) => textOrNull // optional: fetch <dir>/readme.txt
});
```

Returns one record per plugin directory found on the page:

```js
{
  dir: 'contact-form-7',
  version: '6.1.5',              // highest of `versions`, null if none found
  versions: ['6.1.5'],           // everything the page mentioned
  evidence: ['dir', 'asset-ver'],// which methods fired
  suspect: false                 // true when the only version was noise like `71`
}
```

Lower-level helpers, each usable on its own:

| function                       | input        | output                                                  |
| ------------------------------ | ------------ | ------------------------------------------------------- |
| `pluginDirectories(html)`      | HTML string  | `['contact-form-7', …]`                                 |
| `mustUsePlugins(html)`         | HTML string  | `['cache', …]` — basenames from `mu-plugins/<name>.php` |
| `versionsFromAssets(html)`     | HTML string  | `[{dir, version, source}]`                              |
| `versionFromUrl(url)`          | one URL      | `'6.1.5'` or `null`                                     |
| `versionFromReadme(text)`      | readme body  | `'2.13.1'` or `null`                                    |
| `versionsFromHeaders(headers)` | headers      | `[{header, product, version}]`                          |
| `compareVersions(a, b)`        | two versions | `-1 / 0 / 1`, numeric per component                     |
| `isSuspectVersion(v)`          | version      | `true` for `71`, `553`                                  |
| `normalize(text)`              | HTML/JSON    | slashes unescaped, entities decoded                     |

## Design notes that came out of real crawls

- **Escaped slashes.** JSON payloads ship `wp-content\/plugins\/foo\/`, so every
  pattern runs on `normalize()`d text.
- **`mu-plugins`.** Must-use plugins live as bare files in `wp-content/mu-plugins/<name>.php`
  and have no per-plugin directory, so there is nothing to hang a `?ver` on:
  `mustUsePlugins()` returns them by basename and `detectPlugins()` marks the evidence
  `mu-plugin` with `version: null`.
- **Several versions on one page.** Stale assets stay referenced after an update. The
  record keeps all of them and exposes the highest as `version`.
- **Version noise.** Wappalyzer's own extraction sometimes yields `71` for `7.1` and
  `553`. A version without a dot is flagged by `isSuspectVersion()`, not dropped.
- **Headers are per-response, not per-plugin.** `versionsFromHeaders()` returns
  product/version pairs and is not attributed to a plugin directory; caching and
  security plugins are the ones that publish themselves this way.
- **`?ver` is not always the plugin version.** Core, themes and bundled libraries use
  the same query parameter. It is trustworthy only when the URL also carries
  `/wp-content/plugins/<dir>/`.

## Where this could plug into the schema

If the detection engine should consume these methods directly, the smallest addition
is one optional key per technology — the directory it lives in, not its regexes:

```json
"WPBakery": {
  "cats": [87],
  "wpPlugin": { "dir": "js_composer" }
}
```

Then `detectPlugins()` output is joined on `dir`, and `version` is attached the same
way `scriptSrc` attaches it today. This keeps the map in one place (the technology
file) while the extraction stays generic.

## Non-goals

- no list of plugins, slugs or versions;
- no CVE, advisory or target data;
- no network access inside these functions — `readme` is a callback the caller
  supplies, so the module stays pure and testable.
