'use strict';

const wp = require('../src/methods/wp-plugins');

const HTML = `
<link rel="stylesheet" href="/wp-content/plugins/contact-form-7/includes/css/styles.css?ver=6.1.5">
<script src="https://example.com/wp-content/plugins/js_composer/assets/js/dist/js_composer_front.min.js?ver=7.9"></script>
<script src="/wp-content/plugins/elementor/assets/js/frontend.min.js"></script>
<script>var bundle = "\\/wp-content\\/plugins\\/woocommerce\\/assets\\/js\\/frontend.js?ver=10.7.0";</script>
<script src="/wp-content/uploads/cache/bundle.js?ver=71"></script>
`;

describe('pluginDirectories', () => {
  test('finds plugin directories once, in order', () => {
    expect(wp.pluginDirectories(HTML)).toEqual([
      'contact-form-7',
      'js_composer',
      'elementor',
      'woocommerce'
    ]);
  });

  test('understands escaped slashes from JSON payloads', () => {
    expect(
      wp.pluginDirectories('{"u":"\\/wp-content\\/plugins\\/akismet\\/x.js"}')
    ).toEqual(['akismet']);
  });

  test('sees must-use plugins as files, not directories', () => {
    expect(wp.pluginDirectories('/wp-content/mu-plugins/foo.php')).toEqual([]);
    expect(wp.mustUsePlugins('/wp-content/mu-plugins/foo.php')).toEqual([
      'foo'
    ]);
  });
});

describe('versionsFromAssets', () => {
  test('pairs directory with ?ver', () => {
    expect(wp.versionsFromAssets(HTML)).toEqual([
      { dir: 'contact-form-7', version: '6.1.5', source: 'asset-ver' },
      { dir: 'js_composer', version: '7.9', source: 'asset-ver' },
      { dir: 'woocommerce', version: '10.7.0', source: 'asset-ver' }
    ]);
  });

  test('ignores ?ver without a plugin path', () => {
    expect(
      wp.versionsFromAssets('<script src="/cache/bundle.js?ver=71"></script>')
    ).toEqual([]);
  });
});

describe('versionFromUrl / versionFromReadme', () => {
  test('reads the cache-buster', () => {
    expect(wp.versionFromUrl('/a/b.js?ver=1.2.3')).toBe('1.2.3');
    expect(wp.versionFromUrl('/a/b.js')).toBeNull();
  });

  test('reads Stable tag in both readme flavours', () => {
    expect(wp.versionFromReadme('=== Plugin ===\n* Stable tag: 2.13.1\n')).toBe(
      '2.13.1'
    );
    expect(wp.versionFromReadme('Stable tag: 2.0\r\n')).toBe('2.0');
    expect(wp.versionFromReadme('nothing here')).toBeNull();
  });
});

describe('versionsFromHeaders', () => {
  test('parses product/version, including spaces in the product', () => {
    expect(
      wp.versionsFromHeaders({
        'X-Powered-By': 'W3 Total Cache/0.9.4',
        'x-powered-by': 'wpCache/1.2.3',
        Server: 'nginx'
      })
    ).toEqual([
      { header: 'x-powered-by', product: 'W3 Total Cache', version: '0.9.4' },
      { header: 'x-powered-by', product: 'wpCache', version: '1.2.3' }
    ]);
  });
});

describe('detectPlugins', () => {
  test('merges methods per directory and keeps the highest version', () => {
    const found = wp.detectPlugins(HTML, {
      headers: { 'X-Powered-By': 'wpCache/1.2.3' },
      readme: (dir) =>
        dir === 'contact-form-7' ? '* Stable tag: 6.1.7\n' : null
    });

    const byDir = Object.fromEntries(found.map((item) => [item.dir, item]));

    expect(byDir['contact-form-7'].version).toBe('6.1.7');
    expect(byDir['contact-form-7'].versions).toEqual(['6.1.5', '6.1.7']);
    expect(byDir['contact-form-7'].evidence).toContain('readme');
    expect(byDir.elementor.version).toBeNull();
    expect(byDir.elementor.evidence).toEqual(['dir', 'headers-available']);
    expect(byDir.woocommerce.version).toBe('10.7.0');
  });

  test('flags versions that are extraction noise', () => {
    const [item] = wp.detectPlugins(
      '<img src="/wp-content/plugins/a/b.png?ver=71">'
    );
    expect(item.version).toBe('71');
    expect(item.suspect).toBe(true);
  });
});

describe('compareVersions', () => {
  test('compares numerically, not lexically', () => {
    expect(wp.compareVersions('10.7.0', '9.5.2')).toBeGreaterThan(0);
    expect(wp.compareVersions('2.9.2', '2.9.10')).toBeLessThan(0);
    expect(wp.compareVersions('4.6.5', '4.6.5')).toBe(0);
    expect(wp.compareVersions('5.0', '5.0.0')).toBe(0);
  });
});
