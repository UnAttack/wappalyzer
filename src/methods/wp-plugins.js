'use strict';

/**
 * WordPress plugin/version extraction methods.
 *
 * Wappalyzer's schema describes what to look for in a page (scriptSrc, html, meta,
 * headers) and how to pull a version out of a match (`;version:\1`). That works well
 * for one technology at a time, but a WordPress site ships dozens of plugins and the
 * evidence for every one of them has the same three shapes:
 *
 *   1. an asset path      /wp-content/plugins/<dir>/...
 *   2. a cache-buster     ...?ver=<version>
 *   3. a readme endpoint  /wp-content/plugins/<dir>/readme.txt  ("Stable tag:")
 *
 * Repeating those shapes per technology means hundreds of copies of the same regex,
 * and the copy still cannot say which directory belongs to which technology when the
 * directory is not the wp.org slug (`js_composer` vs `WPBakery`). This module keeps
 * the shapes as methods and returns (directory, version) evidence that a resolver can
 * map onto technologies.
 *
 * Nothing here contains a plugin list: the patterns are generic and the output is
 * whatever the page happens to ship.
 */

// A plugin directory as it appears in an asset URL. Must-use plugins are handled
// separately: they live as bare files in `wp-content/mu-plugins/`.
const PLUGIN_DIR = /wp-content\/(?:mu-)?plugins\/([A-Za-z0-9._-]+)\//g;

// Must-use plugin files: `/wp-content/mu-plugins/<name>.php` with no directory of their
// own, so there is nothing to resolve a version against.
const MU_PLUGIN = /wp-content\/mu-plugins\/([A-Za-z0-9._-]+)\.php/g;

// Same path with a cache-buster: `/wp-content/plugins/<dir>/<file>?ver=<version>`.
// `ver` is what WordPress prints for a registered script, so it is the most common
// source of a plugin version on a public page.
const PLUGIN_ASSET_VERSION =
  /wp-content\/(?:mu-)?plugins\/([A-Za-z0-9._-]+)\/[^"'\s>]*[?&]ver=([0-9][0-9A-Za-z._+-]*)/g;

// Bare `?ver=` on any asset, for bundles served by a cache plugin where the plugin
// directory is not part of the URL.
const ANY_VER = /[?&]ver=([0-9][0-9A-Za-z._+-]*)/;

// readme.txt / readme.md shipped with every wp.org plugin.
const STABLE_TAG =
  /^[ \t*#-]*stable[ \t*]+tag[ \t*]*:[ \t*]*([0-9][0-9A-Za-z._+-]*)/im;

// `X-Powered-By: wpCache/1.2.3`, `X-Powered-By: W3 Total Cache/0.9.4`.
const HEADER_PRODUCT =
  /^\s*([A-Za-z][\w .+-]*?)\s*\/\s*([0-9][0-9A-Za-z._+-]*)\s*$/;

// Versions Wappalyzer yields that are really extraction noise (`71` for 7.1, `553`).
// They are flagged, not dropped, so a caller keeps the choice.
const SUSPECT_VERSION = /^[0-9]+$/;

/**
 * WordPress escapes slashes inside JSON payloads, so the same URL can arrive as
 * `wp-content\/plugins\/foo\/...`. Normalise before matching.
 * @param {*} value
 * @returns {string}
 */
function normalize(value) {
  return String(value == null ? '' : value)
    .replace(/\\\//g, '/')
    .replace(/&amp;/g, '&');
}

/**
 * @param {string} version
 * @returns {boolean}
 */
function isSuspectVersion(version) {
  return SUSPECT_VERSION.test(String(version || ''));
}

/**
 * Every plugin directory referenced by the page, in first-seen order.
 * @param {string} html
 * @returns {string[]}
 */
function pluginDirectories(html) {
  const text = normalize(html);
  const found = new Set();
  let match;
  PLUGIN_DIR.lastIndex = 0;
  while ((match = PLUGIN_DIR.exec(text)) !== null) {
    found.add(match[1]);
  }
  return [...found];
}

/**
 * Must-use plugin files, by basename without `.php`.
 * @param {string} html
 * @returns {string[]}
 */
function mustUsePlugins(html) {
  const text = normalize(html);
  const found = new Set();
  let match;
  MU_PLUGIN.lastIndex = 0;
  while ((match = MU_PLUGIN.exec(text)) !== null) {
    found.add(match[1]);
  }
  return [...found];
}

/**
 * (directory, version) pairs harvested from asset URLs.
 * @param {string} html
 * @returns {{dir: string, version: string, source: string}[]}
 */
function versionsFromAssets(html) {
  const text = normalize(html);
  const found = [];
  let match;
  PLUGIN_ASSET_VERSION.lastIndex = 0;
  while ((match = PLUGIN_ASSET_VERSION.exec(text)) !== null) {
    found.push({ dir: match[1], version: match[2], source: 'asset-ver' });
  }
  return found;
}

/**
 * Version from a single asset URL, for callers that already know the plugin.
 * @param {string} url
 * @returns {string|null}
 */
function versionFromUrl(url) {
  const match = ANY_VER.exec(normalize(url));
  return match ? match[1] : null;
}

/**
 * `Stable tag` from a readme body. This is the version of the build that is actually
 * installed, and it survives cache plugins that strip `?ver` from assets.
 * @param {string} readme
 * @returns {string|null}
 */
function versionFromReadme(readme) {
  const match = STABLE_TAG.exec(String(readme || '').replace(/\r\n/g, '\n'));
  return match ? match[1] : null;
}

/**
 * Product/version pairs out of response headers. Cache and security plugins advertise
 * themselves there, and WordPress prints no plugin list of its own.
 * @param {Record<string, string>|Headers} headers
 * @returns {{header: string, product: string, version: string}[]}
 */
function versionsFromHeaders(headers) {
  const entries =
    typeof Headers !== 'undefined' && headers instanceof Headers
      ? [...headers.entries()]
      : Object.entries(headers || {});

  const found = [];
  for (const [name, value] of entries) {
    const raw = Array.isArray(value) ? value.join(', ') : String(value || '');
    for (const part of raw.split(',')) {
      const match = HEADER_PRODUCT.exec(part);
      if (match) {
        found.push({
          header: name.toLowerCase(),
          product: match[1],
          version: match[2]
        });
      }
    }
  }
  return found;
}

/**
 * Numeric-component comparison, so `10.7.0` sorts above `9.5.2`.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function compareVersions(a, b) {
  const toParts = (value) =>
    String(value)
      .split(/[^0-9]+/)
      .filter(Boolean)
      .map(Number);
  const left = toParts(a);
  const right = toParts(b);
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const diff = (left[index] || 0) - (right[index] || 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

/**
 * Merge every method into one evidence set per plugin directory.
 *
 * @param {string} html page or fragment under inspection
 * @param {object} [options]
 * @param {Record<string,string>|Headers} [options.headers]
 * @param {(dir: string) => (string|null)} [options.readme] resolver for readme.txt
 * @returns {{dir: string, version: (string|null), versions: string[], evidence: string[], suspect: boolean}[]}
 */
function detectPlugins(html, options = {}) {
  const byDir = new Map();
  const ensure = (dir) => {
    if (!byDir.has(dir)) {
      byDir.set(dir, { dir, versions: [], evidence: [] });
    }
    return byDir.get(dir);
  };

  for (const dir of pluginDirectories(html)) {
    ensure(dir).evidence.push('dir');
  }

  for (const name of mustUsePlugins(html)) {
    ensure(name).evidence.push('mu-plugin');
  }

  for (const { dir, version } of versionsFromAssets(html)) {
    const entry = ensure(dir);
    entry.evidence.push('asset-ver');
    if (!entry.versions.includes(version)) {
      entry.versions.push(version);
    }
  }

  if (typeof options.readme === 'function') {
    for (const dir of byDir.keys()) {
      const body = options.readme(dir);
      if (!body) {
        continue;
      }
      const version = versionFromReadme(body);
      if (version) {
        const entry = byDir.get(dir);
        entry.evidence.push('readme');
        if (!entry.versions.includes(version)) {
          entry.versions.push(version);
        }
      }
    }
  }

  if (versionsFromHeaders(options.headers).length) {
    for (const entry of byDir.values()) {
      entry.evidence.push('headers-available');
    }
  }

  return [...byDir.values()].map((entry) => {
    // Several versions on one page mean stale assets are still referenced; the
    // highest is the plugin's current build.
    const sorted = entry.versions.slice().sort(compareVersions);
    return {
      dir: entry.dir,
      version: sorted.length ? sorted[sorted.length - 1] : null,
      versions: entry.versions,
      evidence: [...new Set(entry.evidence)],
      suspect: sorted.length ? sorted.every(isSuspectVersion) : false
    };
  });
}

module.exports = {
  ANY_VER,
  HEADER_PRODUCT,
  MU_PLUGIN,
  PLUGIN_ASSET_VERSION,
  PLUGIN_DIR,
  STABLE_TAG,
  compareVersions,
  detectPlugins,
  isSuspectVersion,
  mustUsePlugins,
  normalize,
  pluginDirectories,
  versionFromReadme,
  versionFromUrl,
  versionsFromAssets,
  versionsFromHeaders
};
